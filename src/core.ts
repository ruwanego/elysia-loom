/**
 * LOOM CORE
 * Core artifact generation: guards, middleware, hooks, plugins, and init commands.
 */

import { Glob } from "bun";
import { LOOM_GENERATED_MARKER, LOOM_GENERATED_HEADER, PACKAGE_PATH } from "./constants";
import { CORE_TEMPLATE_MAP, type CoreArtifactKind } from "./core-templates";
import { refreshSkeleton } from "./context";
import { makeDir, pathExists, readJsonIfExists, readText, readTextIfExists, removePath, writeText } from "./fs";
import { normalizeModuleName, normalizeSlash } from "./utils";
import type { LoomContext, ModuleMeta } from "./types";
import { ANCHORS, LoomError, createContext } from "./types";

const CORE_PATH = "src/core";

function coreArtifactDir(kind: CoreArtifactKind) {
  return `${CORE_PATH}/${kind}s`;
}

function coreArtifactPath(kind: CoreArtifactKind, slug: string) {
  return `${coreArtifactDir(kind)}/${slug}.${kind}.ts`;
}

function coreTestPath(kind: CoreArtifactKind, slug: string) {
  return `tests/core/${slug}.${kind}.test.ts`;
}

export function coreExportName(kind: CoreArtifactKind, slug: string) {
  const camel = slug.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());

  switch (kind) {
    case "guard": return `${camel}Guard`;
    case "middleware": return `${camel}Middleware`;
    case "hook": return `${camel}Hook`;
    case "plugin": return `${camel}Plugin`;
  }
}

export async function generateCoreArtifact(
  kind: CoreArtifactKind,
  meta: ModuleMeta,
  generateTest: boolean,
  ctx: LoomContext = createContext()
) {
  const filePath = coreArtifactPath(kind, meta.slug);
  const testPath = coreTestPath(kind, meta.slug);

  if (await pathExists(ctx, filePath)) {
    throw new LoomError(`Core ${kind} already exists: ${filePath}`);
  }

  const { template, testTemplate } = CORE_TEMPLATE_MAP[kind];

  ctx.log(`${ctx.dryRun ? "Planning" : "Generating"} ${kind}: ${meta.slug}`);
  await makeDir(ctx, coreArtifactDir(kind));
  await writeText(ctx, filePath, template(meta));

  if (generateTest) {
    await writeText(ctx, testPath, testTemplate(meta));
  }

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`${kind[0].toUpperCase()}${kind.slice(1)} [${meta.slug}] ${ctx.dryRun ? "planned" : "created"} at ${filePath}`);
}

export async function removeCoreArtifact(
  kind: CoreArtifactKind,
  meta: ModuleMeta,
  ctx: LoomContext = createContext()
) {

  const filePath = coreArtifactPath(kind, meta.slug);
  const testPath = coreTestPath(kind, meta.slug);

  await removePath(ctx, filePath);
  await removePath(ctx, testPath);

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`${kind[0].toUpperCase()}${kind.slice(1)} [${meta.slug}] ${ctx.dryRun ? "removal planned" : "removed"}.`);
}

export async function initSwagger(ctx: LoomContext = createContext()) {
  const entryPath = "src/index.ts";
  const entry = await readTextIfExists(ctx, entryPath);

  if (!entry) {
    throw new LoomError(`${entryPath} not found.`);
  }

  if (entry.includes("swagger")) {
    throw new LoomError("Swagger is already configured in src/index.ts.");
  }

  if (!entry.includes(ANCHORS.import)) {
    throw new LoomError(`Missing import anchor in ${entryPath}.`);
  }

  const importLine = `import { swagger } from '@elysiajs/swagger';\n${ANCHORS.import}`;
  const useLine = `.use(swagger())\n  ${ANCHORS.module}`;
  const next = entry
    .replace(ANCHORS.import, importLine)
    .replace(ANCHORS.module, useLine);

  await writeText(ctx, entryPath, next);

  const pkg = await readJsonIfExists<Record<string, any>>(ctx, PACKAGE_PATH);

  if (pkg && !pkg.dependencies?.["@elysiajs/swagger"] && !pkg.devDependencies?.["@elysiajs/swagger"]) {
    pkg.dependencies = { ...(pkg.dependencies ?? {}), "@elysiajs/swagger": "latest" };
    await writeText(ctx, PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
    ctx.log("Added @elysiajs/swagger to dependencies.");
  }

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`Swagger ${ctx.dryRun ? "planned" : "initialized"} in ${entryPath}.`);
}

export async function listCoreArtifacts(ctx: LoomContext = createContext()) {
  const results: Array<{ kind: CoreArtifactKind; slug: string; path: string }> = [];

  for (const kind of ["guard", "middleware", "hook", "plugin"] as CoreArtifactKind[]) {
    const dir = coreArtifactDir(kind);
    const glob = new Glob(`${dir}/*.${kind}.ts`);

    for await (const path of glob.scan(ctx.root)) {
      const normalized = normalizeSlash(path);
      const match = normalized.match(new RegExp(`([^/]+)\\.${kind}\\.ts$`));

      if (match) {
        results.push({ kind, slug: match[1], path: normalized });
      }
    }
  }

  return results;
}

export async function auditCoreArtifacts(ctx: LoomContext, issues: string[]) {
  const artifacts = await listCoreArtifacts(ctx);

  for (const artifact of artifacts) {
    const content = await readTextIfExists(ctx, artifact.path);

    if (content && !content.includes(LOOM_GENERATED_MARKER)) {
      issues.push(`Core ${artifact.kind} missing ${LOOM_GENERATED_MARKER}: ${artifact.path}`);
    }
  }
}
