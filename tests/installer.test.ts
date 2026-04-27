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

  test("dry-run reports writes without changing the target", async () => {
    const logs: string[] = [];
    const beforePackage = await readFile(join(root, "package.json"), "utf8");
    const beforeIndex = await readFile(join(root, "src", "index.ts"), "utf8");

    await installLoom({
      target: root,
      dryRun: true,
      runCommands: false,
      log: (message) => logs.push(message)
    });

    expect(logs.join("\n")).toContain("[dry-run] copy .loom/AGENT.md");
    expect(logs.join("\n")).toContain("[dry-run] copy dist/loom.js -> scripts/loom.js");
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(beforePackage);
    expect(await readFile(join(root, "src", "index.ts"), "utf8")).toBe(beforeIndex);
    await expect(readFile(join(root, "scripts", "loom.js"), "utf8")).rejects.toThrow();
  });

  test("force reinstall is idempotent for scripts and anchors", async () => {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    pkg.scripts.prepare = "bun run custom";
    await writeFile(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    await installLoom({
      target: root,
      runCommands: false,
      log: () => undefined
    });
    await installLoom({
      target: root,
      force: true,
      runCommands: false,
      log: () => undefined
    });

    const updatedPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const index = await readFile(join(root, "src", "index.ts"), "utf8");

    expect(updatedPackage.scripts.prepare).toBe("bun run hooks:install && bun run custom");
    expect(updatedPackage.scripts.loom).toBe("bun run scripts/loom.js");
    expect(count(index, "// [LOOM_IMPORT_ANCHOR]")).toBe(1);
    expect(count(index, "// [LOOM_MODULE_ANCHOR]")).toBe(1);
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

  test("rejects invalid install targets and app entries", async () => {
    const missingPackageRoot = await mkdtemp(join(tmpdir(), "loom-install-missing-package-"));

    try {
      await expect(installLoom({
        target: missingPackageRoot,
        runCommands: false,
        log: () => undefined
      })).rejects.toThrow("Target must contain package.json");
    } finally {
      await rm(missingPackageRoot, { recursive: true, force: true });
    }

    await writeFile(join(root, "src", "index.ts"), "export const app = {};\n");

    await expect(installLoom({
      target: root,
      runCommands: false,
      log: () => undefined
    })).rejects.toThrow("src/index.ts must contain .listen");
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

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}
