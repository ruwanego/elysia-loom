/**
 * LOOM CORE TEMPLATES
 * Templates for core artifacts: guards, middleware, hooks, plugins.
 * All templates generate idiomatic Elysia plugins using native lifecycle hooks.
 */

import { LOOM_GENERATED_HEADER } from "./constants";
import type { ModuleMeta } from "./types";

export type CoreArtifactKind = "guard" | "middleware" | "hook" | "plugin";

export function guardTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${slug}Guard = new Elysia({ name: 'guard/${slug}' })
  .onBeforeHandle({ as: 'scoped' }, ({ headers, set }) => {
    // TODO: Implement ${slug} guard logic
    // Return a value to short-circuit the request (e.g. 401)
    // Return nothing to allow the request through
  })
  .derive({ as: 'scoped' }, ({ headers }) => {
    // TODO: Extract and return context for downstream handlers
    return {};
  });
`;
}

export function guardTestTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${slug}Guard } from "../../src/core/guards/${slug}.guard";

describe("${slug} guard", () => {
  const app = new Elysia()
    .use(${slug}Guard)
    .get("/test", () => "ok");

  test("allows valid requests", async () => {
    const response = await app.handle(
      new Request("http://localhost/test")
    );

    expect(response.status).toBe(200);
  });
});
`;
}

export function middlewareTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${slug}Middleware = new Elysia({ name: 'middleware/${slug}' })
  .onRequest(({ request }) => {
    // TODO: Implement ${slug} middleware logic
    console.log(\`→ \${request.method} \${new URL(request.url).pathname}\`);
  });
`;
}

export function middlewareTestTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${slug}Middleware } from "../../src/core/middleware/${slug}.middleware";

describe("${slug} middleware", () => {
  const app = new Elysia()
    .use(${slug}Middleware)
    .get("/test", () => "ok");

  test("passes requests through", async () => {
    const response = await app.handle(
      new Request("http://localhost/test")
    );

    expect(response.status).toBe(200);
  });
});
`;
}

export function hookTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${slug}Hook = new Elysia({ name: 'hook/${slug}' })
  .macro(({ onBeforeHandle }) => ({
    ${camelCase(slug)}(enabled: boolean) {
      if (!enabled) return;

      onBeforeHandle(({ set }) => {
        // TODO: Implement ${slug} hook logic
        // Return a value to short-circuit the request
        // Return nothing to allow the request through
      });
    }
  }));
`;
}

export function hookTestTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${slug}Hook } from "../../src/core/hooks/${slug}.hook";

describe("${slug} hook", () => {
  const app = new Elysia()
    .use(${slug}Hook)
    .get("/test", () => "ok", { ${camelCase(slug)}: true });

  test("hook is applied to route", async () => {
    const response = await app.handle(
      new Request("http://localhost/test")
    );

    expect(response.status).toBe(200);
  });
});
`;
}

export function pluginTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${slug}Plugin = new Elysia({ name: 'plugin/${slug}' })
  .decorate('${camelCase(slug)}', {
    // TODO: Add service methods and state
    check() {
      return { status: 'ok', timestamp: Date.now() };
    }
  });
`;
}

export function pluginTestTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${slug}Plugin } from "../../src/core/plugins/${slug}.plugin";

describe("${slug} plugin", () => {
  const app = new Elysia()
    .use(${slug}Plugin)
    .get("/test", ({ ${camelCase(slug)} }) => ${camelCase(slug)}.check());

  test("decorates context", async () => {
    const response = await app.handle(
      new Request("http://localhost/test")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
`;
}

function camelCase(slug: string) {
  return slug.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export const CORE_TEMPLATE_MAP = {
  guard: { template: guardTemplate, testTemplate: guardTestTemplate },
  middleware: { template: middlewareTemplate, testTemplate: middlewareTestTemplate },
  hook: { template: hookTemplate, testTemplate: hookTestTemplate },
  plugin: { template: pluginTemplate, testTemplate: pluginTestTemplate }
} as const;
