/**
 * LOOM CORE TEMPLATES
 * Templates for core artifacts: guards, middleware, hooks, plugins.
 * All templates generate idiomatic Elysia plugins using native lifecycle hooks.
 */

import { LOOM_GENERATED_HEADER } from "../lib/constants";
import type { ModuleMeta } from "../lib/types";

export type CoreArtifactKind = "guard" | "middleware" | "hook" | "plugin";

export function guardTemplate({ slug, pascalName }: ModuleMeta) {
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${name}Guard = new Elysia({ name: 'guard/${slug}' })
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
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Guard } from "../../src/core/guards/${slug}.guard";

describe("${slug} guard", () => {
  const app = new Elysia()
    .use(${name}Guard)
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
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${name}Middleware = new Elysia({ name: 'middleware/${slug}' })
  .onRequest(({ request }) => {
    // TODO: Implement ${slug} middleware logic
    console.log(\`→ \${request.method} \${new URL(request.url).pathname}\`);
  });
`;
}

export function middlewareTestTemplate({ slug, pascalName }: ModuleMeta) {
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Middleware } from "../../src/core/middleware/${slug}.middleware";

describe("${slug} middleware", () => {
  const app = new Elysia()
    .use(${name}Middleware)
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
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${name}Hook = new Elysia({ name: 'hook/${slug}' })
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
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Hook } from "../../src/core/hooks/${slug}.hook";

describe("${slug} hook", () => {
  const app = new Elysia()
    .use(${name}Hook)
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
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';

export const ${name}Plugin = new Elysia({ name: 'plugin/${slug}' })
  .decorate('${camelCase(slug)}', {
    // TODO: Add service methods and state
    check() {
      return { status: 'ok', timestamp: Date.now() };
    }
  });
`;
}

export function pluginTestTemplate({ slug, pascalName }: ModuleMeta) {
  const name = camelCase(slug);

  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Plugin } from "../../src/core/plugins/${slug}.plugin";

describe("${slug} plugin", () => {
  const app = new Elysia()
    .use(${name}Plugin)
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
