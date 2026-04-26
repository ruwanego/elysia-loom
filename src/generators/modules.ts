/**
 * LOOM MODULES
 * Module lifecycle operations: generate, remove, register, route, test, inspect.
 */

import {
  ENTRY_PATH,
  HTTP_METHODS,
  MODULES_PATH,
  moduleDir,
  moduleFiles,
  moduleTestPath
} from "../lib/constants";
import {
  createSkeletonOutput,
  extractPrefix,
  refreshBrief,
  refreshSkeleton
} from "../engine/context";
import {
  listModuleNames,
  makeDir,
  pathExists,
  readText,
  readTextIfExists,
  removePath,
  scanTs,
  writeText
} from "../lib/fs";
import {
  createResourceSpec,
  resourceControllerTemplate,
  resourceSchemaTemplate,
  resourceServiceTemplate,
  resourceTestTemplate
} from "./resource";
import {
  controllerTemplate,
  moduleTestTemplate,
  schemaTemplate,
  serviceTemplate
} from "./templates";
import { escapeRegExp, normalizeModuleName, pascalFromPath } from "../lib/utils";
import type {
  LoomContext,
  ModuleMeta,
  ResourceGenerationOptions
} from "../lib/types";
import { ANCHORS, LoomError, createContext } from "../lib/types";

export async function generateModule(meta: ModuleMeta, ctx: LoomContext = createContext()) {
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
  ctx: LoomContext = createContext()
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

export async function removeModule(meta: ModuleMeta, ctx: LoomContext = createContext()) {
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
  ctx: LoomContext = createContext()
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

export async function generateModuleTest(meta: ModuleMeta, ctx: LoomContext = createContext()) {
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

export async function inspectModule(meta: ModuleMeta, ctx: LoomContext = createContext()) {
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

async function syncAfterMutation(ctx: LoomContext) {
  if (ctx.dryRun) {
    ctx.log(ctx.emitJson
      ? "[dry-run] refresh .loom/context/skeleton.md and .loom/context/skeleton.json"
      : "[dry-run] refresh .loom/context/skeleton.md");
    return;
  }

  await refreshSkeleton(ctx);
}
