import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runLoom } from "../src/loom";
import { createLoomFixture, cleanupLoomFixture, silentContext, runWithOutput } from "./helpers/fixtures";

let root = "";

beforeEach(async () => {
  root = await createLoomFixture();
});

afterEach(async () => {
  await cleanupLoomFixture(root);
});

describe("loom cli", () => {
  test("supports alpha target commands", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "alpha"], ctx)).toBe(0);
    expect(await runLoom(["test", "alpha"], ctx)).toBe(0);
    expect(await runLoom(["route", "alpha", "get", "/ready"], ctx)).toBe(0);
    expect(await runLoom(["sync"], ctx)).toBe(0);

    const skeletonJson = JSON.parse(await readFile(join(root, ".loom", "context", "skeleton.json"), "utf8"));
    expect(skeletonJson.modules[0].name).toBe("alpha");

    const routeLogs: string[] = [];
    expect(await runLoom(["routes"], {
      root,
      log: (message) => routeLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(routeLogs.join("\n")).toContain("GET");
    expect(routeLogs.join("\n")).toContain("/alpha/ready");

    const infoLogs: string[] = [];
    expect(await runLoom(["info"], {
      root,
      log: (message) => infoLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(infoLogs.join("\n")).toContain("LOOM INFO");
    expect(infoLogs.join("\n")).toContain("Modules: 1");
    expect(infoLogs.join("\n")).toContain("Module tests: 1/1");

    const checkLogs: string[] = [];
    expect(await runLoom(["check", "--dry-run"], {
      root,
      log: (message) => checkLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(checkLogs.join("\n")).toContain("bun loom doctor --strict");
    expect(checkLogs.join("\n")).toContain("bun test");

    const helpLogs: string[] = [];
    expect(await runLoom(["help"], {
      root,
      log: (message) => helpLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(helpLogs.join("\n")).toContain("generate resource <name>");
  });

  test("check skips bun test when target has no test files", async () => {
    const logs: string[] = [];

    expect(await runLoom(["sync"], silentContext(root))).toBe(0);
    expect(await runLoom(["check"], {
      root,
      log: (message) => logs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(logs.join("\n")).toContain("Loom doctor --strict passed.");
    expect(logs.join("\n")).toContain("No Bun tests found; skipping bun test.");
  });

  test("rejects invalid commands, fields, routes, and resource specs", async () => {
    const missingField = await runWithOutput(root, ["generate", "resource", "invalid-resource"]);
    expect(missingField.code).toBe(1);
    expect(missingField.errors).toContain("requires at least one --field");

    const badId = await runWithOutput(root, ["generate", "resource", "bad-id", "--field", "id:boolean:readonly"]);
    expect(badId.code).toBe(1);
    expect(badId.errors).toContain("Resource id field must use uuid");

    const badConstraint = await runWithOutput(root, ["generate", "resource", "bad-range", "--field", "name:string:min=10:max=1"]);
    expect(badConstraint.code).toBe(1);
    expect(badConstraint.errors).toContain("min greater than max");

    const badRoute = await runWithOutput(root, ["generate", "resource", "bad-route", "--field", "name:string", "--route", "bad path"]);
    expect(badRoute.code).toBe(1);
    expect(badRoute.errors).toContain("Resource route prefix must start with /");

    const missingFlag = await runWithOutput(root, ["generate", "resource", "missing-flag", "--field"]);
    expect(missingFlag.code).toBe(1);
    expect(missingFlag.errors).toContain("Missing value for --field");

    const unsupportedRoute = await runWithOutput(root, ["route", "missing", "trace", "/x"]);
    expect(unsupportedRoute.code).toBe(1);
    expect(unsupportedRoute.errors).toContain("Unsupported HTTP method");

    const unknown = await runWithOutput(root, ["unknown"]);
    expect(unknown.code).toBe(1);
    expect(unknown.logs).toContain("LOOM CLI");

    const version = await runWithOutput(root, ["--version"]);
    expect(version.code).toBe(0);
    expect(version.logs).toMatch(/\d+\.\d+\.\d+/);
  });
});
