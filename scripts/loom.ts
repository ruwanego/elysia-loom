/**
 * LOOM CLI
 * Agent-centric module generator and skeleton mapper for Bun/Elysia.
 */

import { Glob } from "bun";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const ENTRY_PATH = "src/index.ts";
const MODULES_PATH = "src/modules";
const MODULE_TESTS_PATH = "tests/modules";
const BRIEF_PATH = ".loom/context/brief.md";
const SKELETON_MD_PATH = ".loom/context/skeleton.md";
const SKELETON_JSON_PATH = ".loom/context/skeleton.json";
const MANIFEST_PATH = ".loom/manifest.json";
const PACKAGE_PATH = "package.json";
const LOOM_GENERATED_MARKER = "@loom-generated";
const LOOM_GENERATED_HEADER = `// ${LOOM_GENERATED_MARKER}
// Update with Loom CLI commands.

`;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const FORBIDDEN_PACKAGES = ["zod", "express"];
const EXPECTED_PROTOCOL_COMMANDS = [
  "bun loom make module <name>",
  "bun loom make resource <name> --field <name:type>",
  "bun loom plan resource <name>",
  "bun loom validate resource <name>",
  "bun loom sync",
  "bun loom check",
  "bun loom routes",
  "bun loom info",
  "bun loom g <name>",
  "bun loom route <module> <method> <path>",
  "bun loom test <module>",
  "bun loom brief",
  "bun loom inspect <module>",
  "bun loom s",
  "bun loom s --json",
  "bun loom doctor",
  "bun loom doctor --strict"
];

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

type ParsedArgs = {
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

type ControllerImport = {
  controllerName: string;
  moduleName: string;
  path: string;
};

type RouteSignature = {
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

type SkeletonFile = {
  path: string;
  imports: string[];
  exports: string[];
  routes: RouteSignature[];
  uses: string[];
  skeleton: string[];
};

type SkeletonModule = {
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

type SkeletonContext = {
  generatedAt: string;
  anchors: typeof ANCHORS;
  registrations: ControllerImport[];
  modules: SkeletonModule[];
  files: SkeletonFile[];
};

type ResourceFieldType =
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

type ResourceField = {
  name: string;
  type: ResourceFieldType;
  required: boolean;
  readonly: boolean;
  nullable: boolean;
  constraints: Record<string, string>;
};

type ResourceSpec = {
  meta: ModuleMeta;
  routePrefix: string;
  fields: ResourceField[];
  idField: ResourceField;
  createFields: ResourceField[];
  updateFields: ResourceField[];
};

type ResourceGenerationOptions = {
  fields: string[];
  route?: string;
  plural?: string;
  from?: string;
  generateTest: boolean;
};

type ResourceSpecFile = {
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

class LoomError extends Error {}

export function createContext(options: Partial<LoomContext> = {}): LoomContext {
  return {
    root: options.root ?? ".",
    dryRun: options.dryRun ?? false,
    emitJson: options.emitJson ?? false,
    log: options.log ?? console.log,
    error: options.error ?? console.error
  };
}

export async function runLoom(argv: string[], options: Partial<LoomContext> = {}) {
  const baseCtx = createContext(options);

  try {
    const parsed = parseArgs(argv);
    const ctx = createContext({
      ...options,
      dryRun: Boolean(options.dryRun) || parsed.dryRun,
      emitJson: Boolean(options.emitJson) || parsed.emitJson
    });

    switch (parsed.command) {
      case "m":
      case "make":
        await runMakeCommand(parsed, ctx);
        return 0;

      case "g":
      case "generate":
        await requireModuleName(parsed.args[0], (meta) => generateModule(meta, ctx));
        return 0;

      case "r":
      case "remove":
        await requireModuleName(parsed.args[0], (meta) => removeModule(meta, ctx));
        return 0;

      case "route":
        await addRoute(parsed.args[0], parsed.args[1], parsed.args[2], ctx);
        return 0;

      case "test":
        await requireModuleName(parsed.args[0], (meta) => generateModuleTest(meta, ctx));
        return 0;

      case "plan":
        await runPlanCommand(parsed, ctx);
        return 0;

      case "validate":
        return await runValidateCommand(parsed, ctx);

      case "sync":
        await syncContext(ctx);
        return 0;

      case "check":
        return await runCheck(ctx);

      case "routes":
        await printRoutes(ctx);
        return 0;

      case "info":
        await printInfo(ctx);
        return 0;

      case "dev":
        return await runChildCommand(ctx, ["bun", "run", "dev"]);

      case "brief":
        await refreshBrief(ctx);
        return 0;

      case "inspect":
        await requireModuleName(parsed.args[0], (meta) => inspectModule(meta, ctx));
        return 0;

      case "s":
      case "skeleton":
        await refreshSkeleton(ctx);
        return 0;

      case "doctor":
        return await runDoctor(ctx, parsed.strict);

      case "list":
      case "help":
      case undefined:
      default:
        printHelp(ctx);
        return ["help", "list", undefined].includes(parsed.command) ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof LoomError) {
      baseCtx.error(error.message);
      return 1;
    }

    throw error;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const dryRunFlags = new Set(["--dry-run", "-n"]);
  const jsonFlags = new Set(["--json", "--with-json"]);
  const strictFlags = new Set(["--strict"]);
  const fieldFlags = new Set(["--field", "-f"]);
  const positional: string[] = [];
  const fields: string[] = [];
  let dryRun = false;
  let emitJson = false;
  let strict = false;
  let from: string | undefined;
  let route: string | undefined;
  let plural: string | undefined;
  let test = false;
  let noTest = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (dryRunFlags.has(arg)) {
      dryRun = true;
      continue;
    }

    if (jsonFlags.has(arg)) {
      emitJson = true;
      continue;
    }

    if (strictFlags.has(arg)) {
      strict = true;
      continue;
    }

    if (fieldFlags.has(arg)) {
      fields.push(readFlagValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--route") {
      route = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--from") {
      from = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--plural") {
      plural = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--test" || arg === "--spec") {
      test = true;
      continue;
    }

    if (arg === "--no-test" || arg === "--no-spec") {
      noTest = true;
      continue;
    }

    positional.push(arg);
  }

  return {
    command: positional[0] ?? "help",
    args: positional.slice(1),
    dryRun,
    emitJson,
    strict,
    fields,
    from,
    route,
    plural,
    test,
    noTest
  };
}

function readFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("-")) {
    throw new LoomError(`Missing value for ${flag}.`);
  }

  return value;
}

function printHelp(ctx: LoomContext) {
  ctx.log(`
LOOM CLI
Usage: bun loom <command> [args]

Commands:
  make module <name>        Create a CSS module and auto-register it
  make resource <name>      Create typed CRUD resource from --field flags
  g, generate <name>        Create a CSS module and auto-register it
  r, remove <name>          Remove a generated module and registration
  route <mod> <method> <p>  Add a service-backed route to a module
  test <module>             Generate Bun tests for a CSS module
  sync                      Refresh brief, skeleton.md, and skeleton.json
  check                     Run strict doctor and bun test
  plan <kind> <name>        Preview generated files without writing
  validate [kind] [name]    Validate project or resource specs
  routes                    Print registered module routes
  info                      Print Loom project summary
  dev                       Run bun run dev
  brief                     Refresh the ultra-small agent context
  inspect <module>          Print one module's compact context
  s, skeleton               Refresh the Markdown context map
  doctor                    Audit Loom drift and registration health
  list, help                Show this menu

Flags:
  --dry-run, -n             Print planned writes without changing files
  --json, --with-json       Write both skeleton.md and skeleton.json
  --field, -f <spec>        Resource field: name:type:required:min=1
  --from <path>             Read resource spec JSON
  --route <path>            Resource route prefix override
  --strict                  Enforce TDD and state-management gates in doctor
`);
}

async function runMakeCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;

  switch (kind) {
    case "module":
      await requireModuleName(name, (meta) => generateModule(meta, ctx));
      return;

    case "resource":
      await requireModuleName(name, (meta) => generateResource(meta, {
        fields: parsed.fields,
        route: parsed.route,
        plural: parsed.plural,
        from: parsed.from,
        generateTest: !parsed.noTest
      }, ctx));
      return;

    case undefined:
      throw new LoomError("Usage: bun loom make <module|resource> <name>");

    default:
      throw new LoomError(`Unsupported make target [${kind}].`);
  }
}

async function runPlanCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;
  const planCtx = { ...ctx, dryRun: true };

  switch (kind) {
    case "module":
      await requireModuleName(name, (meta) => generateModule(meta, planCtx));
      return;

    case "resource":
      await requireModuleName(name, (meta) => generateResource(meta, {
        fields: parsed.fields,
        route: parsed.route,
        plural: parsed.plural,
        from: parsed.from,
        generateTest: !parsed.noTest
      }, planCtx));
      return;

    case undefined:
      throw new LoomError("Usage: bun loom plan <module|resource> <name>");

    default:
      throw new LoomError(`Unsupported plan target [${kind}].`);
  }
}

async function runValidateCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;

  if (!kind) {
    return await runDoctor(ctx, false);
  }

  if (kind !== "resource") {
    throw new LoomError(`Unsupported validate target [${kind}].`);
  }

  await requireModuleName(name, async (meta) => {
    const spec = await createResourceSpec(meta, {
      fields: parsed.fields,
      route: parsed.route,
      plural: parsed.plural,
      from: parsed.from,
      generateTest: !parsed.noTest
    }, ctx);

    ctx.log(`Resource spec valid: ${spec.meta.slug}`);
    ctx.log(`Route: ${spec.routePrefix}`);
    ctx.log(`Fields: ${spec.fields.map((field) => field.name).join(", ")}`);
  });

  return 0;
}

async function requireModuleName(
  name: string | undefined,
  action: (meta: ModuleMeta) => Promise<void>
) {
  if (!name) {
    throw new LoomError("Error: module name required.");
  }

  await action(normalizeModuleName(name));
}

export function normalizeModuleName(input: string): ModuleMeta {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new LoomError("Error: module name must contain at least one letter or number.");
  }

  const rawPascalName = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  const pascalName = /^[A-Za-z_$]/.test(rawPascalName)
    ? rawPascalName
    : `Module${rawPascalName}`;

  return {
    slug,
    pascalName,
    controllerName: `${pascalName.charAt(0).toLowerCase()}${pascalName.slice(1)}Controller`
  };
}

export async function generateModule(meta: ModuleMeta, ctx = createContext()) {
  await assertCanGenerate(meta, ctx);

  const dir = moduleDir(meta.slug);

  ctx.log(`${ctx.dryRun ? "Planning" : "Generating"} module: ${meta.slug}`);
  await makeDir(ctx, dir);
  await writeText(ctx, `${dir}/${meta.slug}.schema.ts`, schemaTemplate(meta));
  await writeText(ctx, `${dir}/${meta.slug}.service.ts`, serviceTemplate(meta));
  await writeText(ctx, `${dir}/${meta.slug}.controller.ts`, controllerTemplate(meta));

  await registerModule(meta, ctx);
  await syncAfterMutation(ctx);

  ctx.log(`Module [${meta.slug}] ${ctx.dryRun ? "planned" : "integrated"}.`);
}

export async function generateResource(
  meta: ModuleMeta,
  options: ResourceGenerationOptions,
  ctx = createContext()
) {
  const spec = await createResourceSpec(meta, options, ctx);
  await assertCanGenerate(meta, ctx, spec.routePrefix);

  const dir = moduleDir(meta.slug);

  ctx.log(`${ctx.dryRun ? "Planning" : "Generating"} resource: ${meta.slug}`);
  await makeDir(ctx, dir);
  await writeText(ctx, `${dir}/${meta.slug}.schema.ts`, resourceSchemaTemplate(spec));
  await writeText(ctx, `${dir}/${meta.slug}.service.ts`, resourceServiceTemplate(spec));
  await writeText(ctx, `${dir}/${meta.slug}.controller.ts`, resourceControllerTemplate(spec));

  if (options.generateTest) {
    await writeText(ctx, moduleTestPath(meta.slug), resourceTestTemplate(spec));
  }

  await registerModule(meta, ctx);
  await syncAfterMutation(ctx);

  ctx.log(`Resource [${meta.slug}] ${ctx.dryRun ? "planned" : "integrated"}.`);
}

export async function removeModule(meta: ModuleMeta, ctx = createContext()) {
  await removePath(ctx, moduleDir(meta.slug));
  await removePath(ctx, moduleTestPath(meta.slug));
  await unregisterModule(meta, ctx);
  await syncAfterMutation(ctx);

  ctx.log(`Module [${meta.slug}] ${ctx.dryRun ? "removal planned" : "removed"}.`);
}

export async function addRoute(
  moduleName: string | undefined,
  methodArg: string | undefined,
  routePath: string | undefined,
  ctx = createContext()
) {
  if (!moduleName || !methodArg || !routePath) {
    throw new LoomError("Usage: bun loom route <module> <method> <path>");
  }

  const meta = normalizeModuleName(moduleName);
  const method = methodArg.toLowerCase();

  if (!HTTP_METHODS.has(method)) {
    throw new LoomError(`Unsupported HTTP method [${methodArg}].`);
  }

  if (!routePath.startsWith("/") || /['"`\s]/.test(routePath)) {
    throw new LoomError("Route path must start with / and cannot contain quotes or whitespace.");
  }

  const files = moduleFiles(meta.slug);

  for (const path of Object.values(files)) {
    if (!(await pathExists(ctx, path))) {
      throw new LoomError(`Missing module file: ${path}`);
    }
  }

  const controller = await readText(ctx, files.controller);
  const service = await readText(ctx, files.service);

  if (routeExists(controller, method, routePath)) {
    throw new LoomError(`Route [${method.toUpperCase()} ${routePath}] already exists in ${files.controller}.`);
  }

  const serviceMethod = routeServiceMethod(method, routePath);

  if (new RegExp(`\\b${serviceMethod}\\s*\\(`).test(service)) {
    throw new LoomError(`Service method [${serviceMethod}] already exists in ${files.service}.`);
  }

  await writeText(ctx, files.service, appendServiceMethod(service, meta, method, routePath, serviceMethod));
  await writeText(ctx, files.controller, appendControllerRoute(controller, meta, method, routePath, serviceMethod));
  await syncAfterMutation(ctx);

  ctx.log(`Route [${method.toUpperCase()} ${routePath}] ${ctx.dryRun ? "planned" : "added"} to [${meta.slug}].`);
}

export async function generateModuleTest(meta: ModuleMeta, ctx = createContext()) {
  const files = moduleFiles(meta.slug);
  const testPath = moduleTestPath(meta.slug);

  for (const path of Object.values(files)) {
    if (!(await pathExists(ctx, path))) {
      throw new LoomError(`Missing module file: ${path}`);
    }
  }

  if (await pathExists(ctx, testPath)) {
    throw new LoomError(`Module test already exists: ${testPath}`);
  }

  const controller = await readText(ctx, files.controller);
  const service = await readText(ctx, files.service);

  if (!controller.includes(`export const ${meta.controllerName}`)) {
    throw new LoomError(`${files.controller} must export ${meta.controllerName}.`);
  }

  if (!service.includes(`export const ${meta.pascalName}Service`)) {
    throw new LoomError(`${files.service} must export ${meta.pascalName}Service.`);
  }

  ctx.log(`${ctx.dryRun ? "Planning" : "Generating"} module test: ${meta.slug}`);
  await writeText(ctx, testPath, moduleTestTemplate(meta));
  await refreshBrief(ctx);
  ctx.log(`Module test [${testPath}] ${ctx.dryRun ? "planned" : "created"}.`);
}

export async function inspectModule(meta: ModuleMeta, ctx = createContext()) {
  const output = await createSkeletonOutput(ctx, "<inspect>");
  const module = output.json.modules.find((candidate) => candidate.name === meta.slug);

  if (!module) {
    throw new LoomError(`Module [${meta.slug}] not found.`);
  }

  const files = moduleFiles(meta.slug);
  const testPath = moduleTestPath(meta.slug);
  const hasTest = await pathExists(ctx, testPath);
  const lines = [
    `Module: ${module.name}`,
    `Prefix: ${module.prefix}`,
    `Registered: ${module.registered ? "yes" : "no"}`,
    `Files: controller:${module.files.controller ? "yes" : "no"} service:${module.files.service ? "yes" : "no"} schema:${module.files.schema ? "yes" : "no"} test:${hasTest ? "yes" : "no"}`,
    `Controller: ${files.controller}`,
    `Service: ${files.service}`,
    `Schema: ${files.schema}`,
    `Test: ${testPath}`,
    "Routes:"
  ];

  if (module.routes.length === 0) {
    lines.push("- none");
  }

  for (const route of module.routes) {
    const response = route.response ? ` -> ${route.response}` : "";
    const detail = route.summary ? ` (${route.summary})` : "";
    lines.push(`- ${route.method.toUpperCase()} ${route.path}${response}${detail}`);
  }

  ctx.log(lines.join("\n"));
}

export async function syncContext(ctx = createContext()) {
  await refreshSkeleton({ ...ctx, emitJson: true });
}

export async function runCheck(ctx = createContext()) {
  if (ctx.dryRun) {
    ctx.log("[dry-run] bun loom doctor --strict");
    ctx.log("[dry-run] bun test");
    return 0;
  }

  const doctorCode = await runDoctor(ctx, true);

  if (doctorCode !== 0) {
    return doctorCode;
  }

  if (!(await hasBunTestFiles(ctx))) {
    ctx.log("No Bun tests found; skipping bun test.");
    return 0;
  }

  return await runChildCommand(ctx, ["bun", "test"]);
}

export async function printRoutes(ctx = createContext()) {
  const output = await createSkeletonOutput(ctx, "<routes>");
  const lines = ["METHOD PATH MODULE RESPONSE"];

  for (const module of output.json.modules) {
    for (const route of module.routes) {
      lines.push([
        route.method.toUpperCase().padEnd(6),
        fullRoutePath(module.prefix, route.path).padEnd(24),
        module.name.padEnd(16),
        route.response ?? "-"
      ].join(" "));
    }
  }

  if (lines.length === 1) {
    lines.push("none");
  }

  ctx.log(lines.join("\n"));
}

export async function printInfo(ctx = createContext()) {
  const output = await createSkeletonOutput(ctx, "<info>");
  const manifest = await readJsonIfExists<Record<string, string>>(ctx, MANIFEST_PATH);
  const pkg = await readJsonIfExists<Record<string, any>>(ctx, PACKAGE_PATH);
  const moduleCount = output.json.modules.length;
  const registeredCount = output.json.modules.filter((module) => module.registered).length;
  const routeCount = output.json.modules.reduce((count, module) => count + module.routes.length, 0);
  let testCount = 0;

  for (const module of output.json.modules) {
    if (await pathExists(ctx, moduleTestPath(module.name))) {
      testCount += 1;
    }
  }

  const lines = [
    "LOOM INFO",
    `Package: ${pkg?.name ?? "unknown"}`,
    `Runtime: ${manifest?.runtime ?? "unknown"} / Bun ${Bun.version}`,
    `Framework: ${manifest?.framework ?? "unknown"}`,
    `Schema: ${manifest?.schema ?? "unknown"}`,
    `Pattern: ${manifest?.pattern ?? "unknown"}`,
    `Modules: ${moduleCount}`,
    `Registered: ${registeredCount}/${moduleCount}`,
    `Module tests: ${testCount}/${moduleCount}`,
    `Routes: ${routeCount}`,
    `Context: brief:${await pathExists(ctx, BRIEF_PATH) ? "yes" : "no"} skeleton.md:${await pathExists(ctx, SKELETON_MD_PATH) ? "yes" : "no"} skeleton.json:${await pathExists(ctx, SKELETON_JSON_PATH) ? "yes" : "no"}`
  ];

  ctx.log(lines.join("\n"));
}

async function runChildCommand(ctx: LoomContext, command: string[]) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] ${command.join(" ")}`);
    return 0;
  }

  const process = Bun.spawn(command, {
    cwd: ctx.root,
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await process.exited;

  if (code !== 0) {
    ctx.error(`Command failed (${code}): ${command.join(" ")}`);
  }

  return code;
}

function fullRoutePath(prefix: string, path: string) {
  if (path === "/") {
    return prefix;
  }

  return `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function assertCanGenerate(meta: ModuleMeta, ctx: LoomContext, routePrefix = `/${meta.slug}`) {
  const issues: string[] = [];
  const dir = moduleDir(meta.slug);
  const existingModules = await listModuleNames(ctx);
  const normalizedCollision = existingModules.find((name) => normalizeModuleName(name).slug === meta.slug);
  const entry = await readTextIfExists(ctx, ENTRY_PATH);

  if (await pathExists(ctx, dir)) {
    issues.push(`Module directory already exists: ${dir}`);
  }

  if (normalizedCollision) {
    issues.push(`Module name normalizes to existing module: ${normalizedCollision}`);
  }

  if (!entry) {
    issues.push(`${ENTRY_PATH} is missing.`);
  } else {
    if (!entry.includes(ANCHORS.import) || !entry.includes(ANCHORS.module)) {
      issues.push(`${ENTRY_PATH} is missing Loom anchors.`);
    }

    if (entry.includes(`./modules/${meta.slug}/`)) {
      issues.push(`Module path is already referenced in ${ENTRY_PATH}.`);
    }

    if (entry.includes(meta.controllerName)) {
      issues.push(`Controller symbol [${meta.controllerName}] is already referenced in ${ENTRY_PATH}.`);
    }
  }

  const duplicatePrefix = await findRoutePrefixOwner(ctx, routePrefix);
  if (duplicatePrefix) {
    issues.push(`Route prefix ${routePrefix} is already declared in ${duplicatePrefix}.`);
  }

  const symbolOwner = await findExportOwner(ctx, meta.controllerName);
  if (symbolOwner) {
    issues.push(`Controller symbol [${meta.controllerName}] is already exported by ${symbolOwner}.`);
  }

  if (issues.length > 0) {
    throw new LoomError(`Cannot generate module [${meta.slug}]:\n- ${issues.join("\n- ")}`);
  }
}

function schemaTemplate({ pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { t } from 'elysia';

export const ${pascalName}Schema = t.Object({
  message: t.String(),
  timestamp: t.Number()
});

export type ${pascalName}Response = typeof ${pascalName}Schema.static;
`;
}

function serviceTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import type { ${pascalName}Response } from './${slug}.schema';

export const ${pascalName}Service = {
  getStatus(): ${pascalName}Response {
    return {
      message: "Module ${slug} is functional",
      timestamp: Date.now()
    };
  }
};
`;
}

function controllerTemplate({ slug, pascalName, controllerName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';
import { ${pascalName}Service } from './${slug}.service';
import { ${pascalName}Schema } from './${slug}.schema';

export const ${controllerName} = new Elysia({ prefix: '/${slug}' })
  .get('/', () => ${pascalName}Service.getStatus(), {
    response: ${pascalName}Schema,
    detail: { summary: 'Get ${slug} status' }
  });
`;
}

function moduleTestTemplate({ slug, pascalName, controllerName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { ${controllerName} } from "../../src/modules/${slug}/${slug}.controller";
import { ${pascalName}Service } from "../../src/modules/${slug}/${slug}.service";

describe("${slug} module", () => {
  test("service returns status payload", () => {
    const status = ${pascalName}Service.getStatus();

    expect(status.message).toBe("Module ${slug} is functional");
    expect(typeof status.timestamp).toBe("number");
  });

  test("GET /${slug} returns status payload", async () => {
    const response = await ${controllerName}.handle(
      new Request("http://localhost/${slug}")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Module ${slug} is functional");
    expect(typeof body.timestamp).toBe("number");
  });
});
`;
}

async function createResourceSpec(
  meta: ModuleMeta,
  options: ResourceGenerationOptions,
  ctx = createContext()
): ResourceSpec {
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

async function readResourceSpecFile(ctx: LoomContext, path: string): Promise<ResourceSpecFile> {
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

function parseResourceSpecField(field: ResourceSpecFile["fields"] extends Array<infer T> ? T : never) {
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

function parseResourceField(input: string): ResourceField {
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

function parseResourceFieldType(input: string): ResourceFieldType {
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

function resourceSchemaTemplate(spec: ResourceSpec) {
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

function resourceServiceTemplate(spec: ResourceSpec) {
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

function resourceControllerTemplate(spec: ResourceSpec) {
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

function resourceTestTemplate(spec: ResourceSpec) {
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

function trimLiteralQuotes(value: string) {
  return value.replace(/^"|"$/g, "");
}

function titleName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function camelName(name: string) {
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

function escapeTsString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function registerModule(meta: ModuleMeta, ctx: LoomContext) {
  const content = await readTextIfExists(ctx, ENTRY_PATH);

  if (!content) {
    throw new LoomError(`${ENTRY_PATH} not found. Cannot auto-register module.`);
  }

  if (content.includes(meta.controllerName)) {
    return;
  }

  if (!content.includes(ANCHORS.import) || !content.includes(ANCHORS.module)) {
    throw new LoomError(`Missing Loom anchors in ${ENTRY_PATH}.`);
  }

  const importLine = `import { ${meta.controllerName} } from './modules/${meta.slug}/${meta.slug}.controller';\n${ANCHORS.import}`;
  const useLine = `.use(${meta.controllerName})\n  ${ANCHORS.module}`;
  const next = content
    .replace(ANCHORS.import, importLine)
    .replace(ANCHORS.module, useLine);

  await writeText(ctx, ENTRY_PATH, next);
}

async function unregisterModule(meta: ModuleMeta, ctx: LoomContext) {
  const content = await readTextIfExists(ctx, ENTRY_PATH);

  if (!content) {
    return;
  }

  const next = content
    .replace(
      new RegExp(`^import \\{ ${meta.controllerName} \\} from './modules/${meta.slug}/${meta.slug}\\.controller';\\r?\\n`, "m"),
      ""
    )
    .replace(new RegExp(`^\\s*\\.use\\(${meta.controllerName}\\)\\r?\\n`, "m"), "");

  await writeText(ctx, ENTRY_PATH, next);
}

function appendServiceMethod(
  content: string,
  meta: ModuleMeta,
  method: string,
  routePath: string,
  serviceMethod: string
) {
  const methodBlock = `  ${serviceMethod}(): ${meta.pascalName}Response {
    return {
      message: "Route ${method.toUpperCase()} ${routePath} on module ${meta.slug} is functional",
      timestamp: Date.now()
    };
  }`;

  const trimmed = content.trimEnd();

  if (!trimmed.endsWith("};")) {
    throw new LoomError("Unable to append service method: service file must end with };");
  }

  return `${trimmed.replace(/\n};$/, `,\n\n${methodBlock}\n};`)}\n`;
}

function appendControllerRoute(
  content: string,
  meta: ModuleMeta,
  method: string,
  routePath: string,
  serviceMethod: string
) {
  const routeBlock = `
  .${method}('${routePath}', () => ${meta.pascalName}Service.${serviceMethod}(), {
    response: ${meta.pascalName}Schema,
    detail: { summary: '${method.toUpperCase()} ${routePath} ${meta.slug} route' }
  })`;
  const trimmed = content.trimEnd();

  if (!trimmed.endsWith(";")) {
    throw new LoomError("Unable to append controller route: controller file must end with a semicolon.");
  }

  return `${trimmed.replace(/;$/, `${routeBlock};`)}\n`;
}

function routeExists(content: string, method: string, routePath: string) {
  const escapedPath = escapeRegExp(routePath);
  return new RegExp(`\\.${method}\\(\\s*['"\`]${escapedPath}['"\`]`).test(content);
}

function routeServiceMethod(method: string, routePath: string) {
  return `${method}${pascalFromPath(routePath)}`;
}

function pascalFromPath(routePath: string) {
  const normalized = routePath
    .replace(/:[A-Za-z0-9_-]+/g, (segment) => segment.slice(1))
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return "Root";
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export async function refreshSkeleton(ctx = createContext()) {
  const output = await createSkeletonOutput(ctx);
  const emitJson = ctx.emitJson || await pathExists(ctx, SKELETON_JSON_PATH);

  await writeText(ctx, BRIEF_PATH, await createBrief(ctx, output));
  await writeText(ctx, SKELETON_MD_PATH, output.markdown);

  if (emitJson) {
    await writeText(ctx, SKELETON_JSON_PATH, `${JSON.stringify(output.json, null, 2)}\n`);
  }

  const paths = emitJson
    ? `${SKELETON_MD_PATH} and ${SKELETON_JSON_PATH}`
    : SKELETON_MD_PATH;

  ctx.log(`Skeleton map ${ctx.dryRun ? "planned" : "updated"} in ${paths}`);
}

export async function refreshBrief(ctx = createContext()) {
  const output = await createSkeletonOutput(ctx);
  await writeText(ctx, BRIEF_PATH, await createBrief(ctx, output));
  ctx.log(`Brief context ${ctx.dryRun ? "planned" : "updated"} in ${BRIEF_PATH}`);
}

export async function createSkeleton(ctx = createContext(), generatedAt = new Date().toISOString()) {
  return (await createSkeletonOutput(ctx, generatedAt)).markdown;
}

async function createSkeletonOutput(ctx = createContext(), generatedAt = new Date().toISOString()) {
  const paths = await scanProjectFiles(ctx);
  const entry = await readTextIfExists(ctx, ENTRY_PATH);
  const registrations = entry ? parseControllerImports(entry) : [];
  const registeredNames = new Set(registrations.map((registration) => registration.moduleName));
  const files: SkeletonFile[] = [];
  const modules: SkeletonModule[] = [];
  let markdown = `# PROJECT SKELETON MAP\nGenerated: ${generatedAt}\n\n`;

  for (const path of paths) {
    const content = await readText(ctx, path);
    const skeleton = buildSkeletonLines(content);

    if (skeleton.length === 0) {
      continue;
    }

    files.push({
      path,
      imports: skeleton.filter((line) => line.startsWith("import ")),
      exports: skeleton.filter((line) => line.startsWith("export ")),
      routes: extractRoutes(content),
      uses: extractUses(content),
      skeleton
    });

    markdown += `### File: ${path}\n\`\`\`typescript\n${skeleton.join("\n")}\n\`\`\`\n\n`;
  }

  for (const name of await listModuleNames(ctx)) {
    const filesForModule = moduleFiles(name);
    const controller = await readTextIfExists(ctx, filesForModule.controller);
    const prefix = controller ? extractPrefix(controller) ?? `/${name}` : `/${name}`;

    modules.push({
      name,
      prefix,
      files: {
        controller: await pathExists(ctx, filesForModule.controller),
        service: await pathExists(ctx, filesForModule.service),
        schema: await pathExists(ctx, filesForModule.schema)
      },
      registered: registeredNames.has(name),
      routes: controller ? extractRoutes(controller) : []
    });
  }

  return {
    markdown,
    json: {
      generatedAt,
      anchors: ANCHORS,
      registrations,
      modules,
      files
    }
  };
}

async function createBrief(
  ctx = createContext(),
  output: Awaited<ReturnType<typeof createSkeletonOutput>> | undefined = undefined,
  generatedAt = new Date().toISOString()
) {
  const skeleton = output ?? await createSkeletonOutput(ctx, generatedAt);
  const manifest = await readJsonIfExists<Record<string, string>>(ctx, MANIFEST_PATH);
  const runtime = manifest?.runtime ?? "unknown";
  const framework = manifest?.framework ?? "unknown";
  const schema = manifest?.schema ?? "unknown";
  const pattern = manifest?.pattern ?? "unknown";
  const lines = [
    "# LOOM BRIEF",
    `Generated: ${skeleton.json.generatedAt}`,
    "",
    `Stack: ${runtime}/${framework}/${schema}/${pattern}`,
    "Read: brief first; then skeleton.md OR skeleton.json, not both.",
    "TDD: write/generate tests before behavior changes; strict doctor requires module tests.",
    "CLI: make module | make resource --field | plan | validate | sync | check | routes | info | g | route | test | s | s --json | brief | inspect | doctor | doctor --strict",
    "",
    "Modules:"
  ];

  if (skeleton.json.modules.length === 0) {
    lines.push("- none");
  }

  for (const module of skeleton.json.modules) {
    const hasTest = await pathExists(ctx, moduleTestPath(module.name));
    lines.push(`- ${module.name} ${module.prefix} test:${hasTest ? "yes" : "no"} registered:${module.registered ? "yes" : "no"}`);

    for (const route of module.routes) {
      const response = route.response ? ` -> ${route.response}` : "";
      lines.push(`  ${route.method.toUpperCase()} ${route.path}${response}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildSkeletonLines(content: string) {
  const sourceLines = content.split("\n");
  const output: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const trimmed = sourceLines[index].trim();

    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }

    if (trimmed.startsWith("import ")) {
      output.push(trimmed);
      continue;
    }

    if (/^export const \w+Schema = t\.Object\(\{/.test(trimmed)) {
      const { block, nextIndex } = collectUntil(sourceLines, index, (line) => line.trim() === "});");
      output.push(...block.map((line) => line.trimEnd()));
      index = nextIndex;
      continue;
    }

    if (trimmed.startsWith("export type ") || trimmed.startsWith("export interface ")) {
      output.push(stripTrailingBody(trimmed));
      continue;
    }

    if (/^export const \w+Controller = new Elysia/.test(trimmed)) {
      output.push(trimmed);
      continue;
    }

    if (trimmed.startsWith("export ")) {
      output.push(stripExportBody(trimmed));
      continue;
    }

    if (isRouteStart(trimmed)) {
      const { block, nextIndex } = collectRouteBlock(sourceLines, index);
      output.push(...summarizeRouteBlock(block));
      index = nextIndex;
      continue;
    }

    if (trimmed.startsWith(".use(")) {
      output.push(trimmed);
      continue;
    }

    if (/^[A-Za-z_$][\w$]*\([^)]*\)\s*(:\s*[^={]+)?\s*\{?$/.test(trimmed)) {
      output.push(stripTrailingBody(trimmed));
    }
  }

  return output;
}

function collectUntil(lines: string[], startIndex: number, isEnd: (line: string) => boolean) {
  const block: string[] = [];
  let nextIndex = startIndex;

  for (let index = startIndex; index < lines.length; index += 1) {
    block.push(lines[index]);
    nextIndex = index;

    if (isEnd(lines[index])) {
      break;
    }
  }

  return { block, nextIndex };
}

function collectRouteBlock(lines: string[], startIndex: number) {
  const block: string[] = [lines[startIndex]];
  let nextIndex = startIndex;
  const start = lines[startIndex].trim();

  if (start.endsWith(")") || start.endsWith(");")) {
    return { block, nextIndex };
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    block.push(lines[index]);
    nextIndex = index;

    if (/^\}\)[,;]?$/.test(trimmed) || /^\)[,;]?$/.test(trimmed) || /^\}\);$/.test(trimmed)) {
      break;
    }
  }

  return { block, nextIndex };
}

function summarizeRouteBlock(block: string[]) {
  const route = parseRouteBlock(block);

  if (!route) {
    return block.map((line) => line.trim());
  }

  const lines = [`.${route.method}('${route.path}', <handler>${hasRouteOptions(route) ? ", {" : ")"}`];
  const optionLines: string[] = [];

  for (const key of ["body", "query", "params", "headers", "response"] as const) {
    if (route[key]) {
      optionLines.push(`  ${key}: ${route[key]}`);
    }
  }

  if (route.detail) {
    optionLines.push(`  detail: ${route.detail}`);
  } else if (route.summary) {
    optionLines.push(`  detail: { summary: '${route.summary}' }`);
  }

  for (const [index, line] of optionLines.entries()) {
    lines.push(index === optionLines.length - 1 ? line : `${line},`);
  }

  if (hasRouteOptions(route)) {
    lines.push("})");
  }

  return lines;
}

function parseRouteBlock(block: string[]): RouteSignature | undefined {
  const text = block.map((line) => line.trim()).join(" ");
  const match = text.match(/^\.(get|post|put|patch|delete|options|head)\(\s*['"`]([^'"`]+)['"`]/);

  if (!match) {
    return undefined;
  }

  return {
    method: match[1],
    path: match[2],
    body: extractRouteOption(text, "body"),
    query: extractRouteOption(text, "query"),
    params: extractRouteOption(text, "params"),
    headers: extractRouteOption(text, "headers"),
    response: extractRouteOption(text, "response"),
    detail: extractObjectOption(text, "detail"),
    summary: extractSummary(text)
  };
}

function extractRouteOption(text: string, key: string) {
  const match = text.match(new RegExp(`${key}:\\s*([^,}]+)`));
  return match?.[1]?.trim();
}

function extractObjectOption(text: string, key: string) {
  const match = text.match(new RegExp(`${key}:\\s*(\\{.*?\\})\\s*[,}]`));
  return match?.[1]?.trim();
}

function extractSummary(text: string) {
  const match = text.match(/summary:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1];
}

function hasRouteOptions(route: RouteSignature) {
  return Boolean(route.body || route.query || route.params || route.headers || route.response || route.detail || route.summary);
}

function extractRoutes(content: string) {
  const lines = content.split("\n");
  const routes: RouteSignature[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!isRouteStart(lines[index].trim())) {
      continue;
    }

    const { block, nextIndex } = collectRouteBlock(lines, index);
    const route = parseRouteBlock(block);

    if (route) {
      routes.push(route);
    }

    index = nextIndex;
  }

  return routes;
}

function extractUses(content: string) {
  return [...content.matchAll(/^\s*\.use\((\w+)\)/gm)].map((match) => match[1]);
}

function parseControllerImports(content: string): ControllerImport[] {
  return [...content.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/modules\/([^'"]+)\/([^'"]+)\.controller['"];?/gm)]
    .map((match) => ({
      controllerName: match[1],
      moduleName: normalizeSlash(match[2]),
      path: normalizeSlash(`${MODULES_PATH}/${match[2]}/${match[3]}.controller.ts`)
    }));
}

function extractPrefix(content: string) {
  return content.match(/new Elysia\(\{\s*prefix:\s*['"`]([^'"`]+)['"`]/)?.[1];
}

function isRouteStart(trimmed: string) {
  return /^\.(get|post|put|patch|delete|options|head)\(/.test(trimmed);
}

function stripExportBody(line: string) {
  const assignmentIndex = line.indexOf(" = ");

  if (assignmentIndex === -1) {
    return stripTrailingBody(line);
  }

  return line.slice(0, assignmentIndex);
}

function stripTrailingBody(line: string) {
  return line.replace(/\s*\{\s*$/, "").replace(/\s*;\s*$/, "");
}

export async function runDoctor(ctx = createContext(), strict = false) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const entry = await readTextIfExists(ctx, ENTRY_PATH);
  const manifest = await readJsonIfExists<Record<string, unknown>>(ctx, MANIFEST_PATH);
  const pkg = await readJsonIfExists<Record<string, any>>(ctx, PACKAGE_PATH);

  if (!entry) {
    issues.push(`${ENTRY_PATH} is missing.`);
  } else {
    if (!entry.includes(ANCHORS.import)) {
      issues.push(`${ENTRY_PATH} is missing ${ANCHORS.import}.`);
    }

    if (!entry.includes(ANCHORS.module)) {
      issues.push(`${ENTRY_PATH} is missing ${ANCHORS.module}.`);
    }

    const imports = parseControllerImports(entry);
    const uses = new Set(extractUses(entry));

    for (const registration of imports) {
      const controller = await readTextIfExists(ctx, registration.path);

      if (!controller) {
        issues.push(`Registered controller file is missing: ${registration.path}`);
        continue;
      }

      if (!controller.includes(`export const ${registration.controllerName}`)) {
        issues.push(`${registration.path} does not export ${registration.controllerName}.`);
      }

      if (!uses.has(registration.controllerName)) {
        issues.push(`${registration.controllerName} is imported but not used in ${ENTRY_PATH}.`);
      }
    }

    for (const usedController of uses) {
      if (!imports.some((registration) => registration.controllerName === usedController)) {
        issues.push(`${usedController} is used in ${ENTRY_PATH} without a Loom module import.`);
      }
    }
  }

  await auditModules(ctx, entry, issues);
  await auditDuplicatePrefixes(ctx, issues);
  await auditForbiddenPackages(ctx, pkg, issues);
  await auditForbiddenImports(ctx, issues);
  auditManifest(manifest, pkg, issues, warnings);
  await auditSkeletonFreshness(ctx, issues);

  if (strict) {
    await auditStrictState(ctx, entry, issues);
  }

  if (warnings.length > 0) {
    ctx.log(`Loom doctor warnings:\n- ${warnings.join("\n- ")}`);
  }

  if (issues.length > 0) {
    ctx.error(`Loom doctor failed:\n- ${issues.join("\n- ")}`);
    return 1;
  }

  ctx.log(`Loom doctor${strict ? " --strict" : ""} passed.`);
  return 0;
}

async function auditModules(ctx: LoomContext, entry: string | undefined, issues: string[]) {
  const imports = entry ? parseControllerImports(entry) : [];
  const uses = entry ? new Set(extractUses(entry)) : new Set<string>();

  for (const name of await listModuleNames(ctx)) {
    const meta = normalizeModuleName(name);
    const files = moduleFiles(name);

    for (const [kind, path] of Object.entries(files)) {
      if (!(await pathExists(ctx, path))) {
        issues.push(`Module [${name}] is missing ${kind}: ${path}`);
      }
    }

    const controller = await readTextIfExists(ctx, files.controller);

    if (controller && !controller.includes(`export const ${meta.controllerName}`)) {
      issues.push(`${files.controller} should export ${meta.controllerName}.`);
    }

    const imported = imports.some((registration) => registration.moduleName === name);
    const used = uses.has(meta.controllerName);

    if (!imported || !used) {
      issues.push(`Module [${name}] is not fully registered in ${ENTRY_PATH}.`);
    }
  }
}

async function auditStrictState(ctx: LoomContext, entry: string | undefined, issues: string[]) {
  await auditRootAgentBootstraps(ctx, issues);
  await auditProtocolCommandCoverage(ctx, issues);
  await auditModuleTests(ctx, issues);
  await auditGeneratedMarkers(ctx, issues);
  auditIndexModuleImports(entry, issues);
}

async function auditRootAgentBootstraps(ctx: LoomContext, issues: string[]) {
  for (const path of ["AGENT.md", "AGENTS.md", ".loom/AGENT.md"]) {
    if (!(await pathExists(ctx, path))) {
      issues.push(`Strict mode requires ${path}.`);
    }
  }
}

async function auditProtocolCommandCoverage(ctx: LoomContext, issues: string[]) {
  const protocol = [
    await readTextIfExists(ctx, ".loom/AGENT.md") ?? "",
    await readTextIfExists(ctx, "AGENT.md") ?? "",
    await readTextIfExists(ctx, "AGENTS.md") ?? ""
  ].join("\n");

  for (const command of EXPECTED_PROTOCOL_COMMANDS) {
    if (!protocol.includes(command)) {
      issues.push(`Protocol docs must mention ${command}.`);
    }
  }
}

async function auditModuleTests(ctx: LoomContext, issues: string[]) {
  for (const name of await listModuleNames(ctx)) {
    const path = moduleTestPath(name);

    if (!(await pathExists(ctx, path))) {
      issues.push(`Strict TDD gate requires module test: ${path}`);
    }
  }
}

async function auditGeneratedMarkers(ctx: LoomContext, issues: string[]) {
  for (const name of await listModuleNames(ctx)) {
    const files = moduleFiles(name);

    for (const path of Object.values(files)) {
      const content = await readTextIfExists(ctx, path);

      if (content && !content.includes(LOOM_GENERATED_MARKER)) {
        issues.push(`Generated module file missing ${LOOM_GENERATED_MARKER}: ${path}`);
      }
    }

    const testPath = moduleTestPath(name);
    const test = await readTextIfExists(ctx, testPath);

    if (test && !test.includes(LOOM_GENERATED_MARKER)) {
      issues.push(`Generated module test missing ${LOOM_GENERATED_MARKER}: ${testPath}`);
    }
  }
}

function auditIndexModuleImports(entry: string | undefined, issues: string[]) {
  if (!entry) {
    return;
  }

  const moduleImports = [...entry.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/modules\/([^'"]+)['"];?/gm)];
  const loomImports = parseControllerImports(entry);
  const loomImportSymbols = new Set(loomImports.map((registration) => registration.controllerName));

  for (const match of moduleImports) {
    const symbol = match[1];

    if (!loomImportSymbols.has(symbol)) {
      issues.push(`Manual module import detected in ${ENTRY_PATH}: ${match[0]}`);
    }
  }
}

async function auditDuplicatePrefixes(ctx: LoomContext, issues: string[]) {
  const prefixes = new Map<string, string>();

  for (const path of await scanTs(ctx, `${MODULES_PATH}/**/*.controller.ts`)) {
    const content = await readText(ctx, path);
    const prefix = extractPrefix(content);

    if (!prefix) {
      continue;
    }

    const owner = prefixes.get(prefix);

    if (owner) {
      issues.push(`Duplicate route prefix [${prefix}] in ${owner} and ${path}.`);
    } else {
      prefixes.set(prefix, path);
    }
  }
}

async function auditForbiddenPackages(
  ctx: LoomContext,
  pkg: Record<string, any> | undefined,
  issues: string[]
) {
  if (!pkg) {
    issues.push(`${PACKAGE_PATH} is missing or invalid.`);
    return;
  }

  const dependencies = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  };

  for (const forbidden of FORBIDDEN_PACKAGES) {
    if (dependencies[forbidden]) {
      issues.push(`Forbidden package dependency detected: ${forbidden}`);
    }
  }
}

async function auditForbiddenImports(ctx: LoomContext, issues: string[]) {
  const paths = [
    ...(await scanTs(ctx, "src/**/*.ts")),
    ...(await scanTs(ctx, "scripts/**/*.ts"))
  ];

  for (const path of paths) {
    const content = await readText(ctx, path);

    for (const forbidden of FORBIDDEN_PACKAGES) {
      const importPattern = new RegExp(`from\\s+['"]${escapeRegExp(forbidden)}['"]|require\\(\\s*['"]${escapeRegExp(forbidden)}['"]\\s*\\)`);

      if (importPattern.test(content)) {
        issues.push(`Forbidden import [${forbidden}] detected in ${path}.`);
      }
    }
  }
}

function auditManifest(
  manifest: Record<string, unknown> | undefined,
  pkg: Record<string, any> | undefined,
  issues: string[],
  warnings: string[]
) {
  if (!manifest) {
    issues.push(`${MANIFEST_PATH} is missing or invalid.`);
    return;
  }

  const expected = {
    runtime: "Bun",
    framework: "Elysia",
    schema: "TypeBox",
    pattern: "CSS"
  };

  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) {
      issues.push(`${MANIFEST_PATH} expected ${key}=${value}, found ${String(manifest[key])}.`);
    }
  }

  if (manifest.framework === "Elysia" && pkg && !pkg.dependencies?.elysia && !pkg.devDependencies?.elysia) {
    issues.push(`${MANIFEST_PATH} declares Elysia, but package.json does not depend on elysia.`);
  }

  if (manifest.schema === "TypeBox" && pkg?.dependencies?.zod) {
    warnings.push(`${MANIFEST_PATH} declares TypeBox while package.json includes zod.`);
  }
}

async function auditSkeletonFreshness(ctx: LoomContext, issues: string[]) {
  const expected = await createSkeletonOutput(ctx, "<ignored>");
  const expectedBrief = await createBrief(ctx, expected);
  const actualBrief = await readTextIfExists(ctx, BRIEF_PATH);
  const actualMarkdown = await readTextIfExists(ctx, SKELETON_MD_PATH);
  const actualJson = await readJsonIfExists<SkeletonContext>(ctx, SKELETON_JSON_PATH);

  if (!actualBrief) {
    issues.push(`${BRIEF_PATH} is missing. Run bun loom brief or bun loom s.`);
  } else if (normalizeGeneratedMarkdown(actualBrief) !== expectedBrief) {
    issues.push(`${BRIEF_PATH} is stale. Run bun loom brief or bun loom s.`);
  }

  if (!actualMarkdown) {
    issues.push(`${SKELETON_MD_PATH} is missing. Run bun loom s.`);
  } else if (normalizeGeneratedMarkdown(actualMarkdown) !== expected.markdown) {
    issues.push(`${SKELETON_MD_PATH} is stale. Run bun loom s.`);
  }

  if (actualJson) {
    const normalizedJson = { ...actualJson, generatedAt: "<ignored>" };

    if (JSON.stringify(normalizedJson) !== JSON.stringify(expected.json)) {
      issues.push(`${SKELETON_JSON_PATH} is stale. Run bun loom s --json.`);
    }
  }
}

function normalizeGeneratedMarkdown(markdown: string) {
  return markdown.replace(/^Generated: .+$/m, "Generated: <ignored>");
}

async function syncAfterMutation(ctx: LoomContext) {
  if (ctx.dryRun) {
    ctx.log(ctx.emitJson
      ? "[dry-run] refresh .loom/context/skeleton.md and .loom/context/skeleton.json"
      : "[dry-run] refresh .loom/context/skeleton.md");
    return;
  }

  await refreshSkeleton(ctx);
}

async function findRoutePrefixOwner(ctx: LoomContext, prefix: string) {
  for (const path of await scanTs(ctx, `${MODULES_PATH}/**/*.controller.ts`)) {
    const content = await readText(ctx, path);

    if (extractPrefix(content) === prefix) {
      return path;
    }
  }

  return undefined;
}

async function findExportOwner(ctx: LoomContext, exportName: string) {
  for (const path of await scanTs(ctx, "src/**/*.ts")) {
    const content = await readText(ctx, path);

    if (new RegExp(`export\\s+const\\s+${escapeRegExp(exportName)}\\b`).test(content)) {
      return path;
    }
  }

  return undefined;
}

function moduleDir(slug: string) {
  return `${MODULES_PATH}/${slug}`;
}

function moduleFiles(slug: string) {
  return {
    controller: `${MODULES_PATH}/${slug}/${slug}.controller.ts`,
    service: `${MODULES_PATH}/${slug}/${slug}.service.ts`,
    schema: `${MODULES_PATH}/${slug}/${slug}.schema.ts`
  };
}

function moduleTestPath(slug: string) {
  return `${MODULE_TESTS_PATH}/${slug}.test.ts`;
}

async function listModuleNames(ctx: LoomContext) {
  try {
    const entries = await readdir(resolvePath(ctx, MODULES_PATH), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function scanTs(ctx: LoomContext, pattern: string) {
  const glob = new Glob(pattern);
  const paths: string[] = [];

  for await (const path of glob.scan(ctx.root)) {
    paths.push(normalizeSlash(path));
  }

  return paths.sort();
}

async function hasBunTestFiles(ctx: LoomContext) {
  const patterns = [
    "tests/**/*.test.ts",
    "tests/**/*.spec.ts",
    "test/**/*.test.ts",
    "test/**/*.spec.ts"
  ];

  for (const pattern of patterns) {
    const glob = new Glob(pattern);

    for await (const _path of glob.scan(ctx.root)) {
      return true;
    }
  }

  return false;
}

async function scanProjectFiles(ctx: LoomContext) {
  const paths: string[] = [];
  const scanner = ctx.root === "."
    ? new Glob("src/**/*.ts").scan(".")
    : new Glob("src/**/*.ts").scan(ctx.root);

  for await (const path of scanner) {
    paths.push(normalizeSlash(path));
  }

  return paths.sort();
}

async function pathExists(ctx: LoomContext, path: string) {
  try {
    await stat(resolvePath(ctx, path));
    return true;
  } catch {
    return false;
  }
}

async function readText(ctx: LoomContext, path: string) {
  return await Bun.file(resolvePath(ctx, path)).text();
}

async function readTextIfExists(ctx: LoomContext, path: string) {
  if (!(await pathExists(ctx, path))) {
    return undefined;
  }

  return await readText(ctx, path);
}

async function readJsonIfExists<T>(ctx: LoomContext, path: string) {
  const content = await readTextIfExists(ctx, path);

  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

async function makeDir(ctx: LoomContext, path: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] mkdir ${path}`);
    return;
  }

  await mkdir(resolvePath(ctx, path), { recursive: true });
}

async function removePath(ctx: LoomContext, path: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] remove ${path}`);
    return;
  }

  await rm(resolvePath(ctx, path), { recursive: true, force: true });
}

async function writeText(ctx: LoomContext, path: string, content: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] write ${path}`);
    return;
  }

  const absolutePath = resolvePath(ctx, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, content);
}

function resolvePath(ctx: LoomContext, path: string) {
  return join(ctx.root, path);
}

function normalizeSlash(path: string) {
  return path.replace(/\\/g, "/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.main) {
  const code = await runLoom(Bun.argv.slice(2));
  process.exit(code);
}
