import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runLoom } from "../../src/loom";
import { createLoomFixture, cleanupLoomFixture, silentContext } from "../helpers/fixtures";

let root = "";

beforeEach(async () => {
  root = await createLoomFixture();
});

afterEach(async () => {
  await cleanupLoomFixture(root);
});

describe("core generator", () => {
  test("generates, audits, and removes core artifacts and initializes presets", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "guard", "custom-auth"], ctx)).toBe(0);
    expect(await runLoom(["generate", "middleware", "logger"], ctx)).toBe(0);
    expect(await runLoom(["generate", "hook", "on-error"], ctx)).toBe(0);
    expect(await runLoom(["generate", "plugin", "db"], ctx)).toBe(0);
    expect(await runLoom(["init", "swagger"], ctx)).toBe(0);
    expect(await runLoom(["init", "env"], ctx)).toBe(0);
    expect(await runLoom(["init", "auth"], ctx)).toBe(0);
    expect(await runLoom(["init", "observability"], ctx)).toBe(0);

    const customGuard = await readFile(join(root, "src", "core", "guards", "custom-auth.guard.ts"), "utf8");
    expect(customGuard).toContain("export const customAuthGuard = new Elysia({ name: 'guard/custom-auth' })");
    expect(customGuard).toContain("@loom-generated");

    const presetGuard = await readFile(join(root, "src", "core", "guards", "auth.guard.ts"), "utf8");
    const envPlugin = await readFile(join(root, "src", "core", "plugins", "env.plugin.ts"), "utf8");
    const authPlugin = await readFile(join(root, "src", "core", "plugins", "auth.plugin.ts"), "utf8");
    const loggerPlugin = await readFile(join(root, "src", "core", "plugins", "logger.plugin.ts"), "utf8");
    const guardTest = await readFile(join(root, "tests", "core", "custom-auth.guard.test.ts"), "utf8");
    const authPresetTest = await readFile(join(root, "tests", "core", "auth.guard.test.ts"), "utf8");
    const authPluginTest = await readFile(join(root, "tests", "core", "auth.plugin.test.ts"), "utf8");

    expect(presetGuard).toContain("return status(401, { error: 'Unauthorized' })");
    expect(envPlugin).toContain("process.env.NODE_ENV ?? 'development'");
    expect(authPlugin).toContain("parseBearer");
    expect(loggerPlugin).toContain("logger.info('request'");
    expect(guardTest).toContain("describe(\"custom-auth guard\"");
    expect(authPresetTest).toContain("rejects anonymous requests");
    expect(authPresetTest).toContain("rejects malformed bearer tokens");
    expect(authPresetTest).toContain("allows authenticated requests");
    expect(authPluginTest).toContain("extracts bearer tokens");
    expect(authPluginTest).toContain("returns undefined for missing authorization header");
    expect(authPluginTest).toContain("returns undefined for non-bearer authorization");

    const swaggerIndex = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(swaggerIndex).toContain("import { swagger } from '@elysiajs/swagger';");
    expect(swaggerIndex).toContain(".use(swagger())");

    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.dependencies["@elysiajs/swagger"]).toBeDefined();
    expect(pkg.dependencies["@elysiajs.env"]).toBeUndefined();
    expect(pkg.dependencies["@elysiajs/env"]).toBeUndefined();

    expect(await runLoom(["doctor"], ctx)).toBe(0);

    expect(await runLoom(["remove", "guard", "custom-auth"], ctx)).toBe(0);
    await expect(readFile(join(root, "src", "core", "guards", "custom-auth.guard.ts"), "utf8")).rejects.toThrow();
  });
});
