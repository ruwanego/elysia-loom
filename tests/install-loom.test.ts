import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLoom } from "../src/installer";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-install-test-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fresh-elysia-app",
      scripts: {
        dev: "bun run --watch src/index.ts"
      },
      dependencies: {
        elysia: "latest"
      }
    }, null, 2)
  );
  await writeFile(
    join(root, "src", "index.ts"),
    `import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/', () => 'Hello Elysia')
  .listen(3000);

export type App = typeof app;
`
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loom installer", () => {
  test("exposes a bunx-compatible package bin", async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8"));
    const installer = await readFile(join(import.meta.dir, "..", "src", "installer.ts"), "utf8");

    expect(pkg.name).toBe("elysia-loom");
    expect(pkg.version).toContain("alpha");
    expect(pkg.bin["elysia-loom"]).toBe("./dist/installer.js");
    expect(pkg.bin["create-loom"]).toBe("./dist/installer.js");
    expect(pkg.bin["loom-install"]).toBe("./dist/installer.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("templates/default");
    expect(pkg.scripts.prepack).toBe("bun run build");
    expect(pkg.module).toBe("dist/loom.js");
    expect(installer.startsWith("#!/usr/bin/env bun")).toBe(true);
  });

  test("bootstraps Loom files and anchors", async () => {
    await installLoom({
      target: root,
      runCommands: false,
      log: () => undefined
    });

    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const index = await readFile(join(root, "src", "index.ts"), "utf8");

    expect(pkg.scripts.loom).toBe("bun run scripts/loom.js");
    expect(pkg.scripts["loom:check"]).toBe("bun loom check");
    expect(pkg.scripts.prepare).toBe("bun run hooks:install");
    expect(index).toContain("// [LOOM_IMPORT_ANCHOR]");
    expect(index).toContain("// [LOOM_MODULE_ANCHOR]");
    expect(await readFile(join(root, "scripts", "loom.js"), "utf8")).toBeTruthy();
    expect(await readFile(join(root, ".loom", "AGENT.md"), "utf8")).toContain("Optimized Loom Protocol");
    expect(await readFile(join(root, ".loom", "manifest.json"), "utf8")).toContain("\"framework\": \"Elysia\"");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Agent Bootstrap");
    expect(await readFile(join(root, ".github", "workflows", "loom.yml"), "utf8")).toContain("bun loom check");
    expect(await readFile(join(root, ".githooks", "pre-push"), "utf8")).toContain("bun loom check");
    await expect(readFile(join(root, "tests", "loom.test.ts"), "utf8")).rejects.toThrow();
  });

  test("refuses to overwrite existing Loom files without force", async () => {
    await mkdir(join(root, ".loom"), { recursive: true });
    await writeFile(join(root, ".loom", "AGENT.md"), "custom");

    await expect(installLoom({
      target: root,
      runCommands: false,
      log: () => undefined
    })).rejects.toThrow("Refusing to overwrite");
  });

  test("runs canonical sync and check during install", async () => {
    const logs: string[] = [];

    await installLoom({
      target: root,
      runCommands: true,
      health: false,
      log: (message) => logs.push(message)
    });

    expect(logs.join("\n")).toContain("> bun loom sync");
    expect(logs.join("\n")).toContain("> bun loom check");
    expect(await readFile(join(root, ".loom", "context", "skeleton.json"), "utf8")).toContain("generatedAt");
  });
});
