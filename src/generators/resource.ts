/**
 * LOOM RESOURCE
 * Resource field parsing, spec creation, and resource-specific templates.
 */

import { LOOM_GENERATED_HEADER } from "../lib/constants";
import { readTextIfExists } from "../lib/fs";
import type {
  LoomContext,
  ModuleMeta,
  ResourceField,
  ResourceFieldType,
  ResourceGenerationOptions,
  ResourceSpec,
  ResourceSpecFile
} from "../lib/types";
import { LoomError, createContext } from "../lib/types";
import { camelName, escapeTsString, normalizeModuleName, titleName, trimLiteralQuotes } from "../lib/utils";

export async function createResourceSpec(
  meta: ModuleMeta,
  options: ResourceGenerationOptions,
  ctx: LoomContext = createContext()
): Promise<ResourceSpec> {
  const specFile = options.from ? await readResourceSpecFile(ctx, options.from) : undefined;
  const specFields = (specFile?.fields ?? []).map(parseResourceSpecField);
  const inlineFields = options.fields.map(parseResourceField);
  const requestedFields = [...specFields, ...inlineFields];

  if (requestedFields.length === 0) {
    throw new LoomError("Resource generation requires at least one --field <name:type> flag.");
  }

  const fields = ensureResourceIdField(requestedFields);
  const seen = new Set<string>();

  for (const field of fields) {
    if (seen.has(field.name)) {
      throw new LoomError(`Duplicate resource field [${field.name}].`);
    }

    seen.add(field.name);
  }

  const routeSource = options.route
    ?? specFile?.route
    ?? (options.plural ? `/${normalizeModuleName(options.plural).slug}` : undefined)
    ?? (specFile?.plural ? `/${normalizeModuleName(specFile.plural).slug}` : undefined)
    ?? `/${meta.slug}`;
  const routePrefix = normalizeRoutePrefix(routeSource);
  const idField = fields.find((field) => field.name === "id");

  if (!idField) {
    throw new LoomError("Resource generation failed to resolve an id field.");
  }

  validateResourceIdField(idField);

  return {
    meta,
    routePrefix,
    fields,
    idField,
    createFields: fields.filter((field) => !field.readonly),
    updateFields: fields.filter((field) => !field.readonly)
  };
}

export async function readResourceSpecFile(ctx: LoomContext, path: string): Promise<ResourceSpecFile> {
  const content = await readTextIfExists(ctx, path);

  if (!content) {
    throw new LoomError(`Resource spec file not found: ${path}`);
  }

  try {
    return JSON.parse(content) as ResourceSpecFile;
  } catch {
    throw new LoomError(`Resource spec file is not valid JSON: ${path}`);
  }
}

export function parseResourceSpecField(field: ResourceSpecFile["fields"] extends Array<infer T> ? T : never) {
  if (typeof field === "string") {
    return parseResourceField(field);
  }

  if (!field || typeof field !== "object") {
    throw new LoomError("Resource spec fields must be strings or objects.");
  }

  const tokens = [
    field.name,
    field.type,
    field.required ? "required" : undefined,
    field.optional ? "optional" : undefined,
    field.readonly ? "readonly" : undefined,
    field.nullable ? "nullable" : undefined,
    ...Object.entries(field.constraints ?? {}).map(([key, value]) => `${key}=${value}`)
  ].filter(Boolean);

  return parseResourceField(tokens.join(":"));
}

export function parseResourceField(input: string): ResourceField {
  const parts = input.split(":").map((part) => part.trim()).filter(Boolean);
  const [name, typeRaw, ...tokens] = parts;

  if (!name || !typeRaw) {
    throw new LoomError(`Invalid field spec [${input}]. Use name:type[:required|optional|readonly|nullable][:min=1].`);
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new LoomError(`Invalid field name [${name}]. Use a TypeScript-safe identifier.`);
  }

  let required = true;
  let sawRequired = false;
  let sawOptional = false;
  let readonly = false;
  let nullable = false;
  const constraints: Record<string, string> = {};

  for (const token of tokens) {
    if (token === "required") {
      required = true;
      sawRequired = true;
      continue;
    }

    if (token === "optional") {
      required = false;
      sawOptional = true;
      continue;
    }

    if (token === "readonly") {
      readonly = true;
      continue;
    }

    if (token === "nullable") {
      nullable = true;
      continue;
    }

    const constraint = token.match(/^([A-Za-z][A-Za-z0-9]*?)=(.+)$/);

    if (!constraint) {
      throw new LoomError(`Unsupported field token [${token}] in [${input}].`);
    }

    constraints[constraint[1]] = constraint[2];
  }

  if (sawRequired && sawOptional) {
    throw new LoomError(`Field [${name}] cannot be both required and optional.`);
  }

  validateFieldConstraints(name, typeRaw, constraints);

  return {
    name,
    type: parseResourceFieldType(typeRaw),
    required,
    readonly,
    nullable,
    constraints
  };
}

export function parseResourceFieldType(input: string): ResourceFieldType {
  const type = input.trim();
  const arrayMatch = type.match(/^array<(.+)>$/);
  const enumMatch = type.match(/^enum\((.+)\)$/);

  if (arrayMatch) {
    return { kind: "array", item: parseResourceFieldType(arrayMatch[1]) };
  }

  if (enumMatch) {
    const values = enumMatch[1].split(",").map((value) => value.trim()).filter(Boolean);

    if (values.length === 0 || values.some((value) => !/^[A-Za-z0-9_-]+$/.test(value))) {
      throw new LoomError(`Invalid enum type [${input}]. Use enum(admin,user).`);
    }

    return { kind: "enum", values };
  }

  switch (type) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "uuid":
    case "email":
    case "url":
    case "date":
    case "json":
      return { kind: type };

    default:
      throw new LoomError(`Unsupported field type [${input}].`);
  }
}

function validateFieldConstraints(name: string, typeRaw: string, constraints: Record<string, string>) {
  const allowed = new Set(["min", "max", "minLength", "maxLength", "minItems", "maxItems"]);

  for (const [key, value] of Object.entries(constraints)) {
    if (!allowed.has(key)) {
      throw new LoomError(`Unsupported constraint [${key}] on field [${name}].`);
    }

    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      throw new LoomError(`Constraint [${key}] on field [${name}] must be numeric.`);
    }
  }

  const min = Number(constraints.minLength ?? constraints.min);
  const max = Number(constraints.maxLength ?? constraints.max);

  if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
    throw new LoomError(`Field [${name}] has min greater than max.`);
  }

  if ((constraints.minItems || constraints.maxItems) && !typeRaw.startsWith("array<")) {
    throw new LoomError(`Field [${name}] uses item constraints but is not an array.`);
  }
}

function ensureResourceIdField(fields: ResourceField[]) {
  const idIndex = fields.findIndex((field) => field.name === "id");

  if (idIndex === -1) {
    return [
      parseResourceField("id:uuid:readonly"),
      ...fields
    ];
  }

  return fields.map((field, index) => index === idIndex
    ? { ...field, required: true, readonly: true }
    : field);
}

function validateResourceIdField(field: ResourceField) {
  if (!["uuid", "string", "integer", "number"].includes(field.type.kind)) {
    throw new LoomError("Resource id field must use uuid, string, integer, or number.");
  }
}

function normalizeRoutePrefix(input: string) {
  if (!input.startsWith("/") || /['"`\s]/.test(input)) {
    throw new LoomError("Resource route prefix must start with / and cannot contain quotes or whitespace.");
  }

  return input.replace(/\/+$/, "") || "/";
}

export function resourceSchemaTemplate(spec: ResourceSpec) {
  const { pascalName } = spec.meta;

  return `${LOOM_GENERATED_HEADER}import { t } from 'elysia';

export const ${pascalName}Schema = t.Object({
${schemaFieldLines(spec.fields, "base")}
});

export const Create${pascalName}Schema = t.Object({
${schemaFieldLines(spec.createFields, "create")}
});

export const Update${pascalName}Schema = t.Object({
${schemaFieldLines(spec.updateFields, "update")}
});

export const ${pascalName}ParamsSchema = t.Object({
  id: ${fieldSchemaExpression(spec.idField, false)}
});

export const ${pascalName}ListSchema = t.Array(${pascalName}Schema);

export const ${pascalName}DeleteSchema = t.Object({
  ok: t.Boolean(),
  id: ${fieldSchemaExpression(spec.idField, false)}
});

export const ${pascalName}ErrorSchema = t.Object({
  error: t.String()
});

export type ${pascalName} = typeof ${pascalName}Schema.static;
export type Create${pascalName}Input = typeof Create${pascalName}Schema.static;
export type Update${pascalName}Input = typeof Update${pascalName}Schema.static;
export type ${pascalName}Params = typeof ${pascalName}ParamsSchema.static;
export type ${pascalName}DeleteResponse = typeof ${pascalName}DeleteSchema.static;
export type ${pascalName}ErrorResponse = typeof ${pascalName}ErrorSchema.static;
`;
}

function schemaFieldLines(fields: ResourceField[], mode: "base" | "create" | "update") {
  if (fields.length === 0) {
    return "";
  }

  return fields
    .map((field) => {
      const optional = mode === "update" || !field.required;
      return `  ${field.name}: ${fieldSchemaExpression(field, optional)}`;
    })
    .join(",\n");
}

function fieldSchemaExpression(field: ResourceField, optional: boolean) {
  let expression = baseFieldSchemaExpression(field.type, field.constraints);

  if (field.nullable) {
    expression = `t.Union([${expression}, t.Null()])`;
  }

  return optional ? `t.Optional(${expression})` : expression;
}

function baseFieldSchemaExpression(type: ResourceFieldType, constraints: Record<string, string>): string {
  switch (type.kind) {
    case "string":
      return typeBoxCall("String", typeOptions("string", constraints));

    case "number":
      return typeBoxCall("Number", typeOptions("number", constraints));

    case "integer":
      return typeBoxCall("Integer", typeOptions("number", constraints));

    case "boolean":
      return "t.Boolean()";

    case "uuid":
      return typeBoxCall("String", typeOptions("string", constraints, { format: "uuid" }));

    case "email":
      return typeBoxCall("String", typeOptions("string", constraints, { format: "email" }));

    case "url":
      return typeBoxCall("String", typeOptions("string", constraints, { format: "uri" }));

    case "date":
      return typeBoxCall("String", typeOptions("string", constraints, { format: "date-time" }));

    case "json":
      return "t.Unknown()";

    case "enum":
      return type.values.length === 1
        ? `t.Literal('${escapeTsString(type.values[0])}')`
        : `t.Union([${type.values.map((value) => `t.Literal('${escapeTsString(value)}')`).join(", ")}])`;

    case "array":
      return typeBoxCall("Array", undefined, baseFieldSchemaExpression(type.item, {}), typeOptions("array", constraints));
  }
}

function typeBoxCall(name: string, options?: string, firstArg?: string, secondOptions?: string) {
  if (firstArg && secondOptions) {
    return `t.${name}(${firstArg}, ${secondOptions})`;
  }

  if (firstArg) {
    return `t.${name}(${firstArg})`;
  }

  return options ? `t.${name}(${options})` : `t.${name}()`;
}

function typeOptions(
  kind: "string" | "number" | "array",
  constraints: Record<string, string>,
  base: Record<string, string> = {}
) {
  const entries: string[] = [];

  for (const [key, value] of Object.entries(base)) {
    entries.push(`${key}: '${escapeTsString(value)}'`);
  }

  if (kind === "string") {
    const minLength = constraints.minLength ?? constraints.min;
    const maxLength = constraints.maxLength ?? constraints.max;

    if (minLength) entries.push(`minLength: ${Number(minLength)}`);
    if (maxLength) entries.push(`maxLength: ${Number(maxLength)}`);
  }

  if (kind === "number") {
    if (constraints.min) entries.push(`minimum: ${Number(constraints.min)}`);
    if (constraints.max) entries.push(`maximum: ${Number(constraints.max)}`);
  }

  if (kind === "array") {
    if (constraints.minItems) entries.push(`minItems: ${Number(constraints.minItems)}`);
    if (constraints.maxItems) entries.push(`maxItems: ${Number(constraints.maxItems)}`);
  }

  return entries.length > 0 ? `{ ${entries.join(", ")} }` : undefined;
}

export function resourceServiceTemplate(spec: ResourceSpec) {
  const { slug, pascalName } = spec.meta;
  const storeName = `${camelName(pascalName)}Store`;
  const fixtureName = `${camelName(pascalName)}Fixture`;
  const nextIdExpression = nextIdExpressionFor(spec.idField, storeName, pascalName);

  return `${LOOM_GENERATED_HEADER}import type {
  Create${pascalName}Input,
  ${pascalName},
  ${pascalName}DeleteResponse,
  ${pascalName}Params,
  Update${pascalName}Input
} from './${slug}.schema';

const ${fixtureName}: ${pascalName} = ${objectLiteral(spec.fields)};

// TODO: Replace with database adapter
const ${storeName}: ${pascalName}[] = [{ ...${fixtureName} }];

function next${pascalName}Id(): ${pascalName}["id"] {
  return ${nextIdExpression};
}

export const ${pascalName}Service = {
  list(): ${pascalName}[] {
    return [...${storeName}];
  },

  get(id: ${pascalName}Params["id"]): ${pascalName} | undefined {
    return ${storeName}.find((item) => item.id === id);
  },

  create(input: Create${pascalName}Input): ${pascalName} {
    const next: ${pascalName} = {
      ...${fixtureName},
      ...input,
      id: next${pascalName}Id()
    };

    ${storeName}.push(next);
    return next;
  },

  update(id: ${pascalName}Params["id"], input: Update${pascalName}Input): ${pascalName} | undefined {
    const index = ${storeName}.findIndex((item) => item.id === id);

    if (index === -1) {
      return undefined;
    }

    const next: ${pascalName} = {
      ...${storeName}[index],
      ...input,
      id
    };

    ${storeName}[index] = next;
    return next;
  },

  remove(id: ${pascalName}Params["id"]): ${pascalName}DeleteResponse | undefined {
    const index = ${storeName}.findIndex((item) => item.id === id);

    if (index === -1) {
      return undefined;
    }

    ${storeName}.splice(index, 1);

    return {
      ok: true,
      id
    };
  }
};
`;
}

export function resourceControllerTemplate(spec: ResourceSpec) {
  const { slug, pascalName, controllerName } = spec.meta;

  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';
import { ${pascalName}Service } from './${slug}.service';
import {
  Create${pascalName}Schema,
  ${pascalName}DeleteSchema,
  ${pascalName}ErrorSchema,
  ${pascalName}ListSchema,
  ${pascalName}ParamsSchema,
  ${pascalName}Schema,
  Update${pascalName}Schema
} from './${slug}.schema';

export const ${controllerName} = new Elysia({ prefix: '${spec.routePrefix}' })
  .get('/', () => ${pascalName}Service.list(), {
    response: ${pascalName}ListSchema,
    detail: { summary: 'List ${slug}' }
  })
  .post('/', ({ body }) => ${pascalName}Service.create(body), {
    body: Create${pascalName}Schema,
    response: ${pascalName}Schema,
    detail: { summary: 'Create ${slug}' }
  })
  .get('/:id', ({ params, status }) => ${pascalName}Service.get(params.id) ?? status(404, { error: '${pascalName} not found' }), {
    params: ${pascalName}ParamsSchema,
    response: {
      200: ${pascalName}Schema,
      404: ${pascalName}ErrorSchema
    },
    detail: { summary: 'Get ${slug} by id' }
  })
  .patch('/:id', ({ params, body, status }) => ${pascalName}Service.update(params.id, body) ?? status(404, { error: '${pascalName} not found' }), {
    params: ${pascalName}ParamsSchema,
    body: Update${pascalName}Schema,
    response: {
      200: ${pascalName}Schema,
      404: ${pascalName}ErrorSchema
    },
    detail: { summary: 'Update ${slug} by id' }
  })
  .delete('/:id', ({ params, status }) => ${pascalName}Service.remove(params.id) ?? status(404, { error: '${pascalName} not found' }), {
    params: ${pascalName}ParamsSchema,
    response: {
      200: ${pascalName}DeleteSchema,
      404: ${pascalName}ErrorSchema
    },
    detail: { summary: 'Delete ${slug} by id' }
  });
`;
}

export function resourceTestTemplate(spec: ResourceSpec) {
  const { slug, pascalName, controllerName } = spec.meta;
  const createPayload = objectLiteral(spec.createFields);
  const idValue = fieldFixtureValue(spec.idField);
  const createAssertions = spec.createFields
    .map((field) => `    expect(body.${field.name}).toEqual(createPayload.${field.name});`)
    .join("\n");

  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { ${controllerName} } from "../../src/modules/${slug}/${slug}.controller";
import { ${pascalName}Service } from "../../src/modules/${slug}/${slug}.service";
import type { Create${pascalName}Input } from "../../src/modules/${slug}/${slug}.schema";

const createPayload: Create${pascalName}Input = ${createPayload};

describe("${slug} resource", () => {
  test("service creates typed resource payload", () => {
    const created = ${pascalName}Service.create(createPayload);

    expect(created.id).toBeDefined();
${spec.createFields.map((field) => `    expect(created.${field.name}).toEqual(createPayload.${field.name});`).join("\n")}
  });

  test("GET ${spec.routePrefix} lists resources", async () => {
    const response = await ${controllerName}.handle(
      new Request("http://localhost${spec.routePrefix}")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST ${spec.routePrefix} validates body and returns resource", async () => {
    const response = await ${controllerName}.handle(
      new Request("http://localhost${spec.routePrefix}", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createPayload)
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBeDefined();
${createAssertions}
  });

  test("DELETE ${spec.routePrefix}/:id returns delete payload", async () => {
    const response = await ${controllerName}.handle(
      new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(idValue)}", {
        method: "DELETE"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
`;
}

function objectLiteral(fields: ResourceField[]) {
  if (fields.length === 0) {
    return "{}";
  }

  return `{
${fields.map((field) => `  ${field.name}: ${fieldFixtureValue(field)}`).join(",\n")}
}`;
}

function fieldFixtureValue(field: ResourceField): string {
  return fixtureForType(field.type, field.name, field.constraints);
}

function nextIdExpressionFor(field: ResourceField, storeName: string, pascalName: string) {
  switch (field.type.kind) {
    case "uuid":
      return `crypto.randomUUID() as ${pascalName}["id"]`;

    case "integer":
    case "number":
      return `(${storeName}.length + 1) as ${pascalName}["id"]`;

    case "string":
      return `String(Date.now()) as ${pascalName}["id"]`;

    default:
      return `crypto.randomUUID() as ${pascalName}["id"]`;
  }
}

function fixtureForType(type: ResourceFieldType, fieldName: string, constraints: Record<string, string>): string {
  switch (type.kind) {
    case "string":
      return JSON.stringify(constrainedString(`Example ${titleName(fieldName)}`, constraints));

    case "number":
      return String(constrainedNumber(1.5, constraints));

    case "integer":
      return String(Math.trunc(constrainedNumber(1, constraints)));

    case "boolean":
      return "true";

    case "uuid":
      return JSON.stringify("00000000-0000-4000-8000-000000000000");

    case "email":
      return JSON.stringify(`${fieldName.toLowerCase()}@example.com`);

    case "url":
      return JSON.stringify(`https://example.com/${fieldName}`);

    case "date":
      return JSON.stringify("2026-01-01T00:00:00.000Z");

    case "json":
      return `{ value: "example" }`;

    case "enum":
      return JSON.stringify(type.values[0]);

    case "array":
      return `[${fixtureForType(type.item, fieldName, {})}]`;
  }
}

function constrainedString(base: string, constraints: Record<string, string>) {
  const min = Number(constraints.minLength ?? constraints.min);
  const max = Number(constraints.maxLength ?? constraints.max);
  let value = base;

  if (Number.isFinite(max) && value.length > max) {
    value = "x".repeat(Math.max(1, max));
  }

  if (Number.isFinite(min) && value.length < min) {
    value = value.padEnd(min, "x");
  }

  return value;
}

function constrainedNumber(base: number, constraints: Record<string, string>) {
  const min = Number(constraints.min);
  const max = Number(constraints.max);
  let value = base;

  if (Number.isFinite(min) && value < min) {
    value = min;
  }

  if (Number.isFinite(max) && value > max) {
    value = max;
  }

  return value;
}
