/**
 * LOOM TYPES
 * Shared type definitions for the Loom CLI.
 */

export const ANCHORS = {
  import: "// [LOOM_IMPORT_ANCHOR]",
  module: "// [LOOM_MODULE_ANCHOR]"
};

export type ModuleMeta = {
  slug: string;
  pascalName: string;
  controllerName: string;
};

export type LoomContext = {
  root: string;
  dryRun: boolean;
  emitJson: boolean;
  log: (message: string) => void;
  error: (message: string) => void;
};

export type ParsedArgs = {
  command: string;
  args: string[];
  dryRun: boolean;
  emitJson: boolean;
  strict: boolean;
  fields: string[];
  from?: string;
  route?: string;
  plural?: string;
  test: boolean;
  noTest: boolean;
};

export type ControllerImport = {
  controllerName: string;
  moduleName: string;
  path: string;
};

export type RouteSignature = {
  method: string;
  path: string;
  response?: string;
  body?: string;
  query?: string;
  params?: string;
  headers?: string;
  detail?: string;
  summary?: string;
};

export type SkeletonFile = {
  path: string;
  imports: string[];
  exports: string[];
  routes: RouteSignature[];
  uses: string[];
  skeleton: string[];
};

export type SkeletonModule = {
  name: string;
  prefix: string;
  files: {
    controller: boolean;
    service: boolean;
    schema: boolean;
  };
  registered: boolean;
  routes: RouteSignature[];
};

export type SkeletonContext = {
  generatedAt: string;
  anchors: typeof ANCHORS;
  registrations: ControllerImport[];
  modules: SkeletonModule[];
  files: SkeletonFile[];
};

export type ResourceFieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "uuid" }
  | { kind: "email" }
  | { kind: "url" }
  | { kind: "date" }
  | { kind: "json" }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; item: ResourceFieldType };

export type ResourceField = {
  name: string;
  type: ResourceFieldType;
  required: boolean;
  readonly: boolean;
  nullable: boolean;
  constraints: Record<string, string>;
};

export type ResourceSpec = {
  meta: ModuleMeta;
  routePrefix: string;
  fields: ResourceField[];
  idField: ResourceField;
  createFields: ResourceField[];
  updateFields: ResourceField[];
};

export type ResourceGenerationOptions = {
  fields: string[];
  route?: string;
  plural?: string;
  from?: string;
  generateTest: boolean;
};

export type ResourceSpecFile = {
  route?: string;
  plural?: string;
  fields?: Array<string | {
    name: string;
    type: string;
    required?: boolean;
    optional?: boolean;
    readonly?: boolean;
    nullable?: boolean;
    constraints?: Record<string, string | number>;
  }>;
  test?: boolean;
};

export class LoomError extends Error {}

export function createContext(options: Partial<LoomContext> = {}): LoomContext {
  return {
    root: options.root ?? ".",
    dryRun: options.dryRun ?? false,
    emitJson: options.emitJson ?? false,
    log: options.log ?? console.log,
    error: options.error ?? console.error
  };
}
