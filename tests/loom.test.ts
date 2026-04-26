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
  const agentProtocol = `# Optimized Loom Protocol

- bun loom g <name>
- bun loom route <module> <method> <path>
- bun loom test <module>
- bun loom brief
- bun loom inspect <module>
- bun loom s
- bun loom s --json
- bun loom doctor
- bun loom doctor --strict
`;
  await writeFile(join(root, ".loom", "AGENT.md"), agentProtocol);
  await writeFile(join(root, "AGENT.md"), agentProtocol);
  await writeFile(join(root, "AGENTS.md"), agentProtocol);
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

    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(1);
    expect(await runLoom(["test", "init-test"], ctx)).toBe(0);
    const generatedTest = await readFile(join(root, "tests", "modules", "init-test.test.ts"), "utf8");
    expect(generatedTest).toContain("initTestController");
    expect(generatedTest).toContain('new Request("http://localhost/init-test")');
    expect(generatedTest).toContain("@loom-generated");
    expect(await runLoom(["test", "init-test"], ctx)).toBe(1);
    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(0);

    const logs: string[] = [];
    expect(await runLoom(["inspect", "init-test"], {
      root,
      log: (message) => logs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(logs.join("\n")).toContain("Module: init-test");
    expect(logs.join("\n")).toContain("GET /ready");

    expect(await runLoom(["s"], ctx)).toBe(0);
    expect(await runLoom(["doctor"], ctx)).toBe(0);

    const brief = await readFile(join(root, ".loom", "context", "brief.md"), "utf8");
    expect(brief).toContain("LOOM BRIEF");
    expect(brief).toContain("init-test /init-test test:yes");

    const skeletonMarkdown = await readFile(join(root, ".loom", "context", "skeleton.md"), "utf8");
    expect(skeletonMarkdown).toContain("response: InitTestSchema,");
    expect(skeletonMarkdown).toContain("detail: { summary:");
    await expect(readFile(join(root, ".loom", "context", "skeleton.json"), "utf8")).rejects.toThrow();

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

  test("json flag writes markdown and json skeletons", async () => {
    const ctx = silentContext();

    expect(await runLoom(["g", "json-test"], ctx)).toBe(0);
    await expect(readFile(join(root, ".loom", "context", "skeleton.json"), "utf8")).rejects.toThrow();

    expect(await runLoom(["s", "--json"], ctx)).toBe(0);

    const skeletonMarkdown = await readFile(join(root, ".loom", "context", "skeleton.md"), "utf8");
    const skeletonJson = JSON.parse(await readFile(join(root, ".loom", "context", "skeleton.json"), "utf8"));

    expect(skeletonMarkdown).toContain("jsonTestController");
    expect(skeletonJson.modules[0].name).toBe("json-test");
    expect(await runLoom(["doctor"], ctx)).toBe(0);
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
