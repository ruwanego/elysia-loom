/**
 * LOOM CORE
 * Core artifact generation: guards, middleware, hooks, plugins, and init commands.
 */

import { Glob } from "bun";
import { LOOM_GENERATED_HEADER, LOOM_GENERATED_MARKER, PACKAGE_PATH } from "../lib/constants";
import { CORE_TEMPLATE_MAP, type CoreArtifactKind } from "./core-templates";
import { refreshSkeleton } from "../engine/context";
import { makeDir, pathExists, readJsonIfExists, readTextIfExists, removePath, writeText } from "../lib/fs";
import { normalizeSlash } from "../lib/utils";
import type { LoomContext, ModuleMeta } from "../lib/types";
import { ANCHORS, LoomError, createContext } from "../lib/types";

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
  await ensureDependency(ctx, "@elysiajs/swagger");

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`Swagger ${ctx.dryRun ? "planned" : "initialized"} in ${entryPath}.`);
}

export async function initEnv(ctx: LoomContext = createContext()) {
  await writeText(ctx, "src/core/plugins/env.plugin.ts", envPluginTemplate());
  await writeText(ctx, "tests/core/env.plugin.test.ts", envPluginTestTemplate());

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`Env preset ${ctx.dryRun ? "planned" : "initialized"}.`);
}

export async function initAuth(ctx: LoomContext = createContext()) {
  await writeText(ctx, "src/core/plugins/auth.plugin.ts", authPluginTemplate());
  await writeText(ctx, "src/core/guards/auth.guard.ts", authGuardPresetTemplate());
  await writeText(ctx, "tests/core/auth.plugin.test.ts", authPluginTestTemplate());
  await writeText(ctx, "tests/core/auth.guard.test.ts", authGuardPresetTestTemplate());

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`Auth preset ${ctx.dryRun ? "planned" : "initialized"}.`);
}

export async function initObservability(ctx: LoomContext = createContext()) {
  await writeText(ctx, "src/core/plugins/logger.plugin.ts", loggerPluginTemplate());
  await writeText(ctx, "tests/core/logger.plugin.test.ts", loggerPluginTestTemplate());

  if (!ctx.dryRun) {
    await refreshSkeleton(ctx);
  }

  ctx.log(`Observability preset ${ctx.dryRun ? "planned" : "initialized"}.`);
}

async function ensureDependency(ctx: LoomContext, name: string) {
  const pkg = await readJsonIfExists<Record<string, any>>(ctx, PACKAGE_PATH);

  if (!pkg) {
    return;
  }

  if (pkg.dependencies?.[name] || pkg.devDependencies?.[name]) {
    return;
  }

  pkg.dependencies = { ...(pkg.dependencies ?? {}), [name]: "latest" };
  await writeText(ctx, PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  ctx.log(`Added ${name} to dependencies.`);
}

function envPluginTemplate() {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

function readEnvNumber(name: string, fallback: number) {
  const value = process.env[name];
  const parsed = value ? Number(value) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

export const envPlugin = new Elysia({ name: 'plugin/env' })
  .decorate('env', {
    PORT: readEnvNumber('PORT', 3000),
    NODE_ENV: process.env.NODE_ENV ?? 'development'
  });
`;
}

function envPluginTestTemplate() {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { envPlugin } from "../../src/core/plugins/env.plugin";

describe("env plugin", () => {
  const app = new Elysia()
    .use(envPlugin)
    .get("/env", ({ env }) => ({ port: env.PORT }));

  test("decorates validated env on context", async () => {
    const response = await app.handle(new Request("http://localhost/env"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.port).toBe("number");
  });
});
`;
}

function authPluginTemplate() {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

function parseBearer(request: Request) {
  const value = request.headers.get('authorization');

  if (!value?.startsWith('Bearer ')) {
    return undefined;
  }

  return value.slice('Bearer '.length).trim() || undefined;
}

export const authPlugin = new Elysia({ name: 'plugin/auth' })
  .decorate('auth', {
    parseBearer(request: Request) {
      return parseBearer(request);
    }
  })
  .derive(({ request }) => {
    const authToken = parseBearer(request);

    return {
      authToken,
      isAuthenticated: Boolean(authToken)
    };
  });
`;
}

function authGuardPresetTemplate() {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';
import { authPlugin } from '../plugins/auth.plugin';

export const authGuard = new Elysia({ name: 'guard/auth' })
  .use(authPlugin)
  .onBeforeHandle({ as: 'scoped' }, ({ request, status }) => {
    const token = request.headers.get('authorization');

    if (!token?.startsWith('Bearer ') || !token.slice('Bearer '.length).trim()) {
      return status(401, { error: 'Unauthorized' });
    }
  });
`;
}

function authPluginTestTemplate() {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { authPlugin } from "../../src/core/plugins/auth.plugin";

describe("auth plugin", () => {
  test("extracts bearer tokens", () => {
    const request = new Request("http://localhost/auth", {
      headers: { authorization: "Bearer test-token" }
    });

    expect(authPlugin.decorator.auth.parseBearer(request)).toBe("test-token");
  });

  test("returns undefined for missing authorization header", () => {
    const request = new Request("http://localhost/auth");

    expect(authPlugin.decorator.auth.parseBearer(request)).toBeUndefined();
  });

  test("returns undefined for non-bearer authorization", () => {
    const request = new Request("http://localhost/auth", {
      headers: { authorization: "Basic dXNlcjpwYXNz" }
    });

    expect(authPlugin.decorator.auth.parseBearer(request)).toBeUndefined();
  });
});
`;
}

function authGuardPresetTestTemplate() {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { authGuard } from "../../src/core/guards/auth.guard";

describe("auth guard preset", () => {
  const app = new Elysia()
    .use(authGuard)
    .get("/secure", () => ({ ok: true }));

  test("rejects anonymous requests", async () => {
    const response = await app.handle(new Request("http://localhost/secure"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  test("rejects malformed bearer tokens", async () => {
    const response = await app.handle(new Request("http://localhost/secure", {
      headers: { authorization: "Bearer " }
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  test("allows authenticated requests", async () => {
    const response = await app.handle(new Request("http://localhost/secure", {
      headers: { authorization: "Bearer valid-token" }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
`;
}

function loggerPluginTemplate() {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

function requestMetaFrom(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname
  };
}

export const loggerPlugin = new Elysia({ name: 'plugin/logger' })
  .decorate('logger', {
    info(message: string, meta?: Record<string, unknown>) {
      console.info(message, meta ?? {});
    },
    requestMetaFrom(request: Request) {
      return requestMetaFrom(request);
    }
  })
  .onRequest(({ request, logger }) => {
    logger.info('request', requestMetaFrom(request));
  });
`;
}

function loggerPluginTestTemplate() {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { loggerPlugin } from "../../src/core/plugins/logger.plugin";

describe("logger plugin", () => {
  test("builds request metadata", () => {
    const meta = loggerPlugin.decorator.logger.requestMetaFrom(
      new Request("http://localhost/log", { method: "GET" })
    );

    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/log");
  });
});
`;
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
