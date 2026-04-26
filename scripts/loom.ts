/**
 * LOOM CLI
 * Agent-centric module generator and skeleton mapper for Bun/Elysia.
 */

import { Glob } from "bun";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const ENTRY_PATH = "src/index.ts";
const MODULES_PATH = "src/modules";
const SKELETON_MD_PATH = ".loom/context/skeleton.md";
const SKELETON_JSON_PATH = ".loom/context/skeleton.json";
const MANIFEST_PATH = ".loom/manifest.json";
const PACKAGE_PATH = "package.json";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const FORBIDDEN_PACKAGES = ["zod", "express"];

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
  log: (message: string) => void;
  error: (message: string) => void;
};

type ParsedArgs = {
  command: string;
  args: string[];
  dryRun: boolean;
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

type SkeletonOutput = {
  markdown: string;
  json: SkeletonContext;
};

class LoomError extends Error {}

export function createContext(options: Partial<LoomContext> = {}): LoomContext {
  return {
    root: options.root ?? ".",
    dryRun: options.dryRun ?? false,
    log: options.log ?? console.log,
    error: options.error ?? console.error
  };
}

export async function runLoom(argv: string[], options: Partial<LoomContext> = {}) {
  const parsed = parseArgs(argv);
  const ctx = createContext({
    ...options,
    dryRun: Boolean(options.dryRun) || parsed.dryRun
  });

  try {
    switch (parsed.command) {
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

      case "s":
      case "skeleton":
        await refreshSkeleton(ctx);
        return 0;

      case "doctor":
        return await runDoctor(ctx);

      case "help":
      case undefined:
      default:
        printHelp(ctx);
        return parsed.command === "help" || parsed.command === undefined ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof LoomError) {
      ctx.error(error.message);
      return 1;
    }

    throw error;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const dryRunFlags = new Set(["--dry-run", "-n"]);
  const dryRun = argv.some((arg) => dryRunFlags.has(arg));
  const positional = argv.filter((arg) => !dryRunFlags.has(arg));

  return {
    command: positional[0] ?? "help",
    args: positional.slice(1),
    dryRun
  };
}

function printHelp(ctx: LoomContext) {
  ctx.log(`
LOOM CLI
Usage: bun loom <command> [args]

Commands:
  g, generate <name>        Create a CSS module and auto-register it
  r, remove <name>          Remove a generated module and registration
  route <mod> <method> <p>  Add a service-backed route to a module
  s, skeleton               Refresh Markdown and JSON context maps
  doctor                    Audit Loom drift and registration health
  help                      Show this menu

Flags:
  --dry-run, -n             Print planned writes without changing files
`);
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

export async function removeModule(meta: ModuleMeta, ctx = createContext()) {
  await removePath(ctx, moduleDir(meta.slug));
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

async function assertCanGenerate(meta: ModuleMeta, ctx: LoomContext) {
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

  const duplicatePrefix = await findRoutePrefixOwner(ctx, `/${meta.slug}`);
  if (duplicatePrefix) {
    issues.push(`Route prefix /${meta.slug} is already declared in ${duplicatePrefix}.`);
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
  return `import { t } from 'elysia';

export const ${pascalName}Schema = t.Object({
  message: t.String(),
  timestamp: t.Number()
});

export type ${pascalName}Response = typeof ${pascalName}Schema.static;
`;
}

function serviceTemplate({ slug, pascalName }: ModuleMeta) {
  return `import type { ${pascalName}Response } from './${slug}.schema';

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
  return `import { Elysia } from 'elysia';
import { ${pascalName}Service } from './${slug}.service';
import { ${pascalName}Schema } from './${slug}.schema';

export const ${controllerName} = new Elysia({ prefix: '/${slug}' })
  .get('/', () => ${pascalName}Service.getStatus(), {
    response: ${pascalName}Schema,
    detail: { summary: 'Get ${slug} status' }
  });
`;
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
  const output = await createSkeleton(ctx);

  await writeText(ctx, SKELETON_MD_PATH, output.markdown);
  await writeText(ctx, SKELETON_JSON_PATH, `${JSON.stringify(output.json, null, 2)}\n`);

  ctx.log(`Skeleton maps ${ctx.dryRun ? "planned" : "updated"} in .loom/context`);
}

export async function createSkeleton(ctx = createContext(), generatedAt = new Date().toISOString()): Promise<SkeletonOutput> {
  const paths = await scanTs(ctx, "src/**/*.ts");
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

    const file: SkeletonFile = {
      path,
      imports: skeleton.filter((line) => line.startsWith("import ")),
      exports: skeleton.filter((line) => line.startsWith("export ")),
      routes: extractRoutes(content),
      uses: extractUses(content),
      skeleton
    };

    files.push(file);
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

  if (route.summary) {
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
    summary: extractSummary(text)
  };
}

function extractRouteOption(text: string, key: string) {
  const match = text.match(new RegExp(`${key}:\\s*([^,}]+)`));
  return match?.[1]?.trim();
}

function extractSummary(text: string) {
  const match = text.match(/summary:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1];
}

function hasRouteOptions(route: RouteSignature) {
  return Boolean(route.body || route.query || route.params || route.headers || route.response || route.summary);
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

export async function runDoctor(ctx = createContext()) {
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

  if (warnings.length > 0) {
    ctx.log(`Loom doctor warnings:\n- ${warnings.join("\n- ")}`);
  }

  if (issues.length > 0) {
    ctx.error(`Loom doctor failed:\n- ${issues.join("\n- ")}`);
    return 1;
  }

  ctx.log("Loom doctor passed.");
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
  const expected = await createSkeleton(ctx, "<ignored>");
  const actualMarkdown = await readTextIfExists(ctx, SKELETON_MD_PATH);
  const actualJson = await readJsonIfExists<SkeletonContext>(ctx, SKELETON_JSON_PATH);

  if (!actualMarkdown) {
    issues.push(`${SKELETON_MD_PATH} is missing. Run bun loom s.`);
  } else if (normalizeGeneratedMarkdown(actualMarkdown) !== expected.markdown) {
    issues.push(`${SKELETON_MD_PATH} is stale. Run bun loom s.`);
  }

  if (!actualJson) {
    issues.push(`${SKELETON_JSON_PATH} is missing. Run bun loom s.`);
  } else {
    const normalizedActual = { ...actualJson, generatedAt: "<ignored>" };

    if (JSON.stringify(normalizedActual) !== JSON.stringify(expected.json)) {
      issues.push(`${SKELETON_JSON_PATH} is stale. Run bun loom s.`);
    }
  }
}

function normalizeGeneratedMarkdown(markdown: string) {
  return markdown.replace(/^Generated: .+$/m, "Generated: <ignored>");
}

async function syncAfterMutation(ctx: LoomContext) {
  if (ctx.dryRun) {
    ctx.log("[dry-run] refresh .loom/context/skeleton.md and .loom/context/skeleton.json");
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
