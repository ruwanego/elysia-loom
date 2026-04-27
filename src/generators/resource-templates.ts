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
  code: t.String(),
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
const seed${pascalName} = (): ${pascalName}[] => [{ ...${fixtureName} }];
let ${storeName}: ${pascalName}[] = seed${pascalName}();

function next${pascalName}Id(): ${pascalName}["id"] {
  return ${nextIdExpression};
}

export const ${pascalName}Service = {
  reset(): void {
    ${storeName} = seed${pascalName}();
  },

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
  const notFoundMessage = `${pascalName} not found`;

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
  .post('/', ({ body, set }) => {
    set.status = 201;
    return ${pascalName}Service.create(body);
  }, {
    body: Create${pascalName}Schema,
    response: {
      201: ${pascalName}Schema
    },
    detail: { summary: 'Create ${slug}' }
  })
  .get('/:id', ({ params, status }) => ${pascalName}Service.get(params.id) ?? status(404, { code: 'NOT_FOUND', error: '${notFoundMessage}' }), {
    params: ${pascalName}ParamsSchema,
    response: {
      200: ${pascalName}Schema,
      404: ${pascalName}ErrorSchema
    },
    detail: { summary: 'Get ${slug} by id' }
  })
  .patch('/:id', ({ params, body, status }) => ${pascalName}Service.update(params.id, body) ?? status(404, { code: 'NOT_FOUND', error: '${notFoundMessage}' }), {
    params: ${pascalName}ParamsSchema,
    body: Update${pascalName}Schema,
    response: {
      200: ${pascalName}Schema,
      404: ${pascalName}ErrorSchema
    },
    detail: { summary: 'Update ${slug} by id' }
  })
  .delete('/:id', ({ params, status }) => ${pascalName}Service.remove(params.id) ?? status(404, { code: 'NOT_FOUND', error: '${notFoundMessage}' }), {
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
  const missingIdValue = missingFixtureValue(spec.idField);
  const createAssertions = spec.createFields
    .map((field) => `    expect(body.${field.name}).toEqual(createPayload.${field.name});`)
    .join("\n");
  const notFoundMessage = `${pascalName} not found`;
  const patchInvalidBody = invalidFieldLiteral(spec.createFields[0]);
  const constraintTests = constraintTestLines(spec);

  return `${LOOM_GENERATED_HEADER}import { beforeEach, describe, expect, test } from "bun:test";
import { ${controllerName} } from "../../src/modules/${slug}/${slug}.controller";
import { ${pascalName}Service } from "../../src/modules/${slug}/${slug}.service";
import type { Create${pascalName}Input } from "../../src/modules/${slug}/${slug}.schema";

const createPayload: Create${pascalName}Input = ${createPayload};

describe("${slug} resource", () => {
  beforeEach(() => {
    ${pascalName}Service.reset();
  });

  describe("CRUD happy path", () => {
    test("service creates typed resource payload", () => {
      const created = ${pascalName}Service.create(createPayload);

      expect(created.id).toBeDefined();
${spec.createFields.map((field) => `      expect(created.${field.name}).toEqual(createPayload.${field.name});`).join("\n")}
    });

    test("GET ${spec.routePrefix} lists resources", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
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

      expect(response.status).toBe(201);
      expect(body.id).toBeDefined();
${createAssertions}
    });

    test("GET ${spec.routePrefix}/:id returns seeded resource", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(idValue)}")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toEqual(${idValue});
    });

    test("PATCH ${spec.routePrefix}/:id updates resource fields", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(idValue)}", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createPayload)
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
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

  describe("error handling", () => {
    test("GET ${spec.routePrefix}/:id returns 404 for missing resource", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(missingIdValue)}")
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
      expect(body.error).toBe("${notFoundMessage}");
    });

    test("PATCH ${spec.routePrefix}/:id returns 404 for missing resource", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(missingIdValue)}", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createPayload)
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
      expect(body.error).toBe("${notFoundMessage}");
    });

    test("DELETE ${spec.routePrefix}/:id returns 404 for missing resource", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(missingIdValue)}", {
          method: "DELETE"
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
      expect(body.error).toBe("${notFoundMessage}");
    });

    test("POST ${spec.routePrefix} rejects invalid body", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invalid: true })
        })
      );

      expect(response.status).not.toBe(201);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("PATCH ${spec.routePrefix}/:id rejects invalid body", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}/${trimLiteralQuotes(idValue)}", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ${spec.createFields[0].name}: ${patchInvalidBody} })
        })
      );

      expect(response.status).not.toBe(200);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("data integrity lifecycle", () => {
    test("create, read, update, delete, and verify missing", async () => {
      const createResponse = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createPayload)
        })
      );
      const created = await createResponse.json();

      expect(createResponse.status).toBe(201);
      expect(created.id).toBeDefined();
${createAssertions.replaceAll("body.", "created.")}

      const readResponse = await ${controllerName}.handle(
        new Request(\`http://localhost${spec.routePrefix}/\${created.id}\`)
      );
      const fetched = await readResponse.json();

      expect(readResponse.status).toBe(200);
      expect(fetched.id).toEqual(created.id);
${spec.createFields.map((field) => `      expect(fetched.${field.name}).toEqual(createPayload.${field.name});`).join("\n")}

      const updateResponse = await ${controllerName}.handle(
        new Request(\`http://localhost${spec.routePrefix}/\${created.id}\`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createPayload)
        })
      );
      const updated = await updateResponse.json();

      expect(updateResponse.status).toBe(200);
${spec.createFields.map((field) => `      expect(updated.${field.name}).toEqual(createPayload.${field.name});`).join("\n")}

      const reReadResponse = await ${controllerName}.handle(
        new Request(\`http://localhost${spec.routePrefix}/\${created.id}\`)
      );
      const persisted = await reReadResponse.json();

      expect(reReadResponse.status).toBe(200);
${spec.createFields.map((field) => `      expect(persisted.${field.name}).toEqual(createPayload.${field.name});`).join("\n")}

      const deleteResponse = await ${controllerName}.handle(
        new Request(\`http://localhost${spec.routePrefix}/\${created.id}\`, {
          method: "DELETE"
        })
      );
      const deleted = await deleteResponse.json();

      expect(deleteResponse.status).toBe(200);
      expect(deleted.ok).toBe(true);

      const missingResponse = await ${controllerName}.handle(
        new Request(\`http://localhost${spec.routePrefix}/\${created.id}\`)
      );
      const missing = await missingResponse.json();

      expect(missingResponse.status).toBe(404);
      expect(missing.code).toBe("NOT_FOUND");
    });
  });
${constraintTests}});
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

function missingFixtureValue(field: ResourceField): string {
  switch (field.type.kind) {
    case "uuid":
      return JSON.stringify("00000000-0000-4000-8000-999999999999");

    case "integer":
    case "number":
      return String(999999);

    case "string":
      return JSON.stringify("missing-resource");

    default:
      return JSON.stringify("missing-resource");
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

function invalidFieldLiteral(field: ResourceField): string {
  switch (field.type.kind) {
    case "string":
    case "email":
    case "url":
    case "date":
    case "uuid":
      return "12345";

    case "number":
    case "integer":
      return "\"not-a-number\"";

    case "boolean":
      return "\"not-a-boolean\"";

    case "enum":
      return "12345";

    case "json":
      return "\"not-json\"";

    case "array":
      return "\"not-an-array\"";

    default:
      return "12345";
  }
}

function belowMinLiteral(field: ResourceField): string | undefined {
  const min = Number(field.constraints.minLength ?? field.constraints.min);

  if (!Number.isFinite(min)) {
    return undefined;
  }

  switch (field.type.kind) {
    case "string":
      return min <= 1 ? JSON.stringify("") : JSON.stringify("x".repeat(min - 1));

    case "number":
    case "integer":
      return String(min - 1);

    default:
      return undefined;
  }
}

function aboveMaxLiteral(field: ResourceField): string | undefined {
  const max = Number(field.constraints.maxLength ?? field.constraints.max);

  if (!Number.isFinite(max)) {
    return undefined;
  }

  switch (field.type.kind) {
    case "string":
      return JSON.stringify("x".repeat(max + 1));

    case "number":
    case "integer":
      return String(max + 1);

    default:
      return undefined;
  }
}

function invalidFormatLiteral(field: ResourceField): string | undefined {
  switch (field.type.kind) {
    case "email":
      return JSON.stringify("not-an-email");

    case "url":
      return JSON.stringify("not-a-url");

    default:
      return undefined;
  }
}

function constraintTestLines(spec: ResourceSpec): string {
  const { controllerName } = spec.meta;
  const tests: string[] = [];

  for (const field of spec.createFields) {
    const below = belowMinLiteral(field);

    if (below !== undefined) {
      const constraintName = field.type.kind === "string" ? "minLength" : "minimum";
      tests.push(`
    test("POST ${spec.routePrefix} rejects ${field.name} below ${constraintName}", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...createPayload, ${field.name}: ${below} })
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });`);
    }

    const above = aboveMaxLiteral(field);

    if (above !== undefined) {
      const constraintName = field.type.kind === "string" ? "maxLength" : "maximum";
      tests.push(`
    test("POST ${spec.routePrefix} rejects ${field.name} above ${constraintName}", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...createPayload, ${field.name}: ${above} })
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });`);
    }

    if (field.type.kind === "enum") {
      tests.push(`
    test("POST ${spec.routePrefix} rejects invalid enum value for ${field.name}", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...createPayload, ${field.name}: "__invalid__" })
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });`);
    }

    const format = invalidFormatLiteral(field);

    if (format !== undefined) {
      tests.push(`
    test("POST ${spec.routePrefix} rejects invalid ${field.type.kind} format for ${field.name}", async () => {
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...createPayload, ${field.name}: ${format} })
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });`);
    }

    if (!field.required) {
      tests.push(`
    test("POST ${spec.routePrefix} accepts missing optional field ${field.name}", async () => {
      const { ${field.name}: _omitted, ...withoutField } = createPayload as Record<string, unknown>;
      const response = await ${controllerName}.handle(
        new Request("http://localhost${spec.routePrefix}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withoutField)
        })
      );

      expect(response.status).toBe(201);
    });`);
    }
  }

  if (tests.length === 0) {
    return "";
  }

  return `
  describe("field validation", () => {${tests.join("\n")}
  });
`;
}
