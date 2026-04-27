/**
 * LOOM RESOURCE
 * Resource field parsing, spec creation, and resource-specific templates.
 */

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
import { normalizeModuleName } from "../lib/utils";

import {
  resourceControllerTemplate,
  resourceSchemaTemplate,
  resourceServiceTemplate,
  resourceTestTemplate
} from "./resource-templates";

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

export function parseResourceSpecField(field: NonNullable<ResourceSpecFile["fields"]> extends Array<infer T> ? T : never) {
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

export {
  resourceControllerTemplate,
  resourceSchemaTemplate,
  resourceServiceTemplate,
  resourceTestTemplate
};
