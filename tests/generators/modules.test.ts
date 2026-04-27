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

describe("module generator", () => {
  test("generates, registers, audits, routes, and removes a module", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "init-test"], ctx)).toBe(0);

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

    expect(await runLoom(["skeleton"], ctx)).toBe(0);
    expect(await runLoom(["doctor"], ctx)).toBe(0);

    const brief = await readFile(join(root, ".loom", "context", "brief.md"), "utf8");
    expect(brief).toContain("LOOM BRIEF");
    expect(brief).toContain("init-test /init-test test:yes");

    const skeletonMarkdown = await readFile(join(root, ".loom", "context", "skeleton.md"), "utf8");
    expect(skeletonMarkdown).toContain("response: InitTestSchema,");
    expect(skeletonMarkdown).toContain("detail: { summary:");
    await expect(readFile(join(root, ".loom", "context", "skeleton.json"), "utf8")).rejects.toThrow();

    expect(await runLoom(["remove", "init-test"], ctx)).toBe(0);

    const cleanedIndex = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(cleanedIndex).not.toContain("initTestController");
    expect(await runLoom(["doctor"], ctx)).toBe(0);
  });

  test("dry-run does not write files", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "dry-test", "--dry-run"], ctx)).toBe(0);

    const index = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(index).not.toContain("dryTestController");
    await expect(readFile(join(root, "src", "modules", "dry-test", "dry-test.controller.ts"), "utf8")).rejects.toThrow();
  });

  test("generate supports all generator kinds", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "payments"], ctx)).toBe(0);
    expect(await runLoom(["generate", "resource", "orders", "--field", "name:string:required"], ctx)).toBe(0);
    expect(await runLoom(["generate", "guard", "auth"], ctx)).toBe(0);
    expect(await runLoom(["generate", "module", "audit-log"], ctx)).toBe(0);

    const index = await readFile(join(root, "src", "index.ts"), "utf8");
    const paymentsController = await readFile(join(root, "src", "modules", "payments", "payments.controller.ts"), "utf8");
    const ordersSchema = await readFile(join(root, "src", "modules", "orders", "orders.schema.ts"), "utf8");
    const guard = await readFile(join(root, "src", "core", "guards", "auth.guard.ts"), "utf8");
    const auditLogController = await readFile(join(root, "src", "modules", "audit-log", "audit-log.controller.ts"), "utf8");

    expect(index).toContain("paymentsController");
    expect(index).toContain("ordersController");
    expect(index).toContain("auditLogController");
    expect(paymentsController).toContain("export const paymentsController");
    expect(ordersSchema).toContain("export const OrdersSchema = t.Object");
    expect(guard).toContain("export const authGuard");
    expect(auditLogController).toContain("export const auditLogController");
  });

  test("json flag writes markdown and json skeletons", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "json-test"], ctx)).toBe(0);
    await expect(readFile(join(root, ".loom", "context", "skeleton.json"), "utf8")).rejects.toThrow();

    expect(await runLoom(["skeleton", "--json"], ctx)).toBe(0);

    const skeletonMarkdown = await readFile(join(root, ".loom", "context", "skeleton.md"), "utf8");
    const skeletonJson = JSON.parse(await readFile(join(root, ".loom", "context", "skeleton.json"), "utf8"));

    expect(skeletonMarkdown).toContain("jsonTestController");
    expect(skeletonJson.modules[0].name).toBe("json-test");
    expect(await runLoom(["doctor"], ctx)).toBe(0);
  });

  test("rejects module name collisions", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "billing-api"], ctx)).toBe(0);
    expect(await runLoom(["generate", "module", "billing api"], ctx)).toBe(1);
  });
});
