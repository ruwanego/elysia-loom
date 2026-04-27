/**
 * LOOM RESOURCE TEMPLATES
 * Resource-specific templates for schemas, services, controllers, and tests.
 */

import { LOOM_GENERATED_HEADER } from "../lib/constants";
import type {
  ResourceField,
  ResourceFieldType,
  ResourceSpec
} from "../lib/types";
import { camelName, escapeTsString, titleName, trimLiteralQuotes } from "../lib/utils";

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
