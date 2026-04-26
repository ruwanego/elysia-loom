/**
 * LOOM DOCTOR
 * Audit system, health checks, and informational commands.
 */

import {
  ENTRY_PATH,
  EXPECTED_PROTOCOL_COMMANDS,
  FORBIDDEN_PACKAGES,
  LOOM_GENERATED_MARKER,
  MANIFEST_PATH,
  MODULES_PATH,
  PACKAGE_PATH,
  SKELETON_JSON_PATH,
  SKELETON_MD_PATH,
  BRIEF_PATH,
  moduleFiles,
  moduleTestPath
} from "../lib/constants";
import {
  createBrief,
  createSkeletonOutput,
  extractPrefix,
  extractUses,
  parseControllerImports
} from "./context";
import {
  hasBunTestFiles,
  listModuleNames,
  pathExists,
  readJsonIfExists,
  readText,
  readTextIfExists,
  runChildCommand,
  scanTs
} from "../lib/fs";
import { escapeRegExp, fullRoutePath, normalizeModuleName } from "../lib/utils";
import type { LoomContext } from "../lib/types";
import { ANCHORS, createContext } from "../lib/types";

export async function runDoctor(ctx: LoomContext = createContext(), strict = false) {
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

  const { auditCoreArtifacts } = await import("../generators/core");
  await auditCoreArtifacts(ctx, issues);

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

export async function runCheck(ctx: LoomContext = createContext()) {
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

export async function printRoutes(ctx: LoomContext = createContext()) {
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

export async function printInfo(ctx: LoomContext = createContext()) {
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
