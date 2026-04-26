import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoom } from "../scripts/loom";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-test-"));
  await mkdir(join(root, ".loom"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "loom-fixture",
      scripts: {
        loom: "bun run scripts/loom.ts"
      },
      dependencies: {
        elysia: "latest"
      }
    }, null, 2)
  );
  await writeFile(
    join(root, ".loom", "manifest.json"),
    JSON.stringify({
      runtime: "Bun",
      framework: "Elysia",
      schema: "TypeBox",
      pattern: "CSS"
    }, null, 2)
  );
  await writeFile(
    join(root, "src", "index.ts"),
    `import { Elysia } from 'elysia';
// [LOOM_IMPORT_ANCHOR]

const app = new Elysia()
  .get('/', () => 'Loom Active')
  // [LOOM_MODULE_ANCHOR]
  .listen(3000);

export type App = typeof app;
`
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loom cli", () => {
  test("generates, registers, audits, routes, and removes a module", async () => {
    const ctx = silentContext();

    expect(await runLoom(["g", "init-test"], ctx)).toBe(0);

    const index = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(index).toContain("initTestController");
    expect(index).toContain(".use(initTestController)");

    const controller = await readFile(join(root, "src", "modules", "init-test", "init-test.controller.ts"), "utf8");
    expect(controller).toContain("export const initTestController");

    expect(await runLoom(["doctor"], ctx)).toBe(0);
    expect(await runLoom(["route", "init-test", "get", "/ready"], ctx)).toBe(0);

    const routedController = await readFile(join(root, "src", "modules", "init-test", "init-test.controller.ts"), "utf8");
    const routedService = await readFile(join(root, "src", "modules", "init-test", "init-test.service.ts"), "utf8");
    expect(routedController).toContain(".get('/ready'");
    expect(routedService).toContain("getReady(): InitTestResponse");

    expect(await runLoom(["s"], ctx)).toBe(0);
    expect(await runLoom(["doctor"], ctx)).toBe(0);

    const skeletonMarkdown = await readFile(join(root, ".loom", "context", "skeleton.md"), "utf8");
    expect(skeletonMarkdown).toContain("response: InitTestSchema,");

    const skeletonJson = await readFile(join(root, ".loom", "context", "skeleton.json"), "utf8");
    expect(JSON.parse(skeletonJson).modules[0].routes).toHaveLength(2);

    expect(await runLoom(["r", "init-test"], ctx)).toBe(0);

    const cleanedIndex = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(cleanedIndex).not.toContain("initTestController");
    expect(await runLoom(["doctor"], ctx)).toBe(0);
  });

  test("dry-run does not write files", async () => {
    const ctx = silentContext();

    expect(await runLoom(["g", "dry-test", "--dry-run"], ctx)).toBe(0);

    const index = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(index).not.toContain("dryTestController");
    await expect(readFile(join(root, "src", "modules", "dry-test", "dry-test.controller.ts"), "utf8")).rejects.toThrow();
  });

  test("rejects module name collisions", async () => {
    const ctx = silentContext();

    expect(await runLoom(["g", "billing-api"], ctx)).toBe(0);
    expect(await runLoom(["g", "billing api"], ctx)).toBe(1);
  });
});

function silentContext() {
  return {
    root,
    log: () => undefined,
    error: () => undefined
  };
}
