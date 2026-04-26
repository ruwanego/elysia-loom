import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { installLoom } from "../src/installer";
import { runLoom } from "../src/loom";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = join(repoRoot, ".tmp");

let target = "";

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
  target = await mkdtemp(join(tmpRoot, "loom-e2e-"));
  await mkdir(join(target, "src"), { recursive: true });

  await writeFile(
    join(target, "package.json"),
    JSON.stringify({
      name: "loom-generated-target",
      scripts: {
        dev: "bun run --watch src/index.ts"
      }
    }, null, 2)
  );
  await writeFile(
    join(target, "src", "index.ts"),
    `import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/', () => 'Hello from test app')
  .listen(3000);

export type App = typeof app;
`
  );
});

afterEach(async () => {
  const resolvedTarget = resolve(target);
  const resolvedTmpRoot = `${resolve(tmpRoot)}${sep}`;

  if (resolvedTarget.startsWith(resolvedTmpRoot)) {
    await rm(resolvedTarget, { recursive: true, force: true });
  }
});

describe("loom target app e2e", () => {
  test("creates a target app, installs Loom, then verifies the target command lifecycle", async () => {
    const logs: string[] = [];

    await installLoom({
      target,
      health: true,
      runCommands: true,
      log: (message) => logs.push(message)
    });

    const installedPackage = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    const installedIndex = await readFile(join(target, "src", "index.ts"), "utf8");

    expect(installedPackage.dependencies.elysia).toBe("latest");
    expect(installedPackage.scripts.loom).toBe("bun run scripts/loom.js");
    expect(installedIndex).toContain("Hello from test app");
    expect(installedIndex).toContain("healthController");
    expect(installedIndex).toContain("// [LOOM_IMPORT_ANCHOR]");
    expect(installedIndex).toContain("// [LOOM_MODULE_ANCHOR]");
    expect(await readFile(join(target, ".loom", "context", "skeleton.json"), "utf8")).toContain("generatedAt");
    expect(await readFile(join(target, "tests", "modules", "health.test.ts"), "utf8")).toContain("healthController");
    expect(logs.join("\n")).toContain("> bun loom make module health");
    expect(logs.join("\n")).toContain("> bun loom test health");
    expect(logs.join("\n")).toContain("> bun loom sync");
    expect(logs.join("\n")).toContain("> bun loom check");

    const help = await expectTargetCommand(["help"]);
    expect(help.output).toContain("Usage: bun loom <command> [args]");

    const list = await expectTargetCommand(["list"]);
    expect(list.output).toContain("make resource <name>");

    const initialInfo = await expectTargetCommand(["info"]);
    expect(initialInfo.output).toContain("Modules: 1");

    const initialRoutes = await expectTargetCommand(["routes"]);
    expect(initialRoutes.output).toContain("/health");

    const healthInspect = await expectTargetCommand(["inspect", "health"]);
    expect(healthInspect.output).toContain("Module: health");

    await expectTargetCommand(["validate"]);
    await expectTargetCommand(["doctor"]);
    await expectTargetCommand(["doctor", "--strict"]);
    await expectTargetCommand(["brief"]);
    await expectTargetCommand(["s", "--json"]);
    await expectTargetCommand(["sync"]);

    const plannedModule = await expectTargetCommand(["plan", "module", "planned-module"]);
    expect(plannedModule.output).toContain("[dry-run] write src/modules/planned-module/planned-module.schema.ts");

    await expectTargetCommand(["g", "audit-log"]);
    await expectTargetCommand(["route", "audit-log", "get", "/ready"]);
    await expectTargetCommand(["test", "audit-log"]);

    const auditInspect = await expectTargetCommand(["inspect", "audit-log"]);
    expect(auditInspect.output).toContain("GET /ready");

    await expectTargetCommand(["make", "module", "reports"]);
    await expectTargetCommand(["test", "reports"]);

    await mkdir(join(target, ".loom", "specs"), { recursive: true });
    await writeFile(
      join(target, ".loom", "specs", "posts.resource.json"),
      JSON.stringify({
        route: "/posts",
        fields: [
          "title:string:required:min=2",
          { name: "published", type: "boolean", optional: true }
        ]
      }, null, 2)
    );

    const plannedResource = await expectTargetCommand(["plan", "resource", "posts", "--from", ".loom/specs/posts.resource.json"]);
    expect(plannedResource.output).toContain("[dry-run] write src/modules/posts/posts.schema.ts");

    const validatedResource = await expectTargetCommand(["validate", "resource", "posts", "--from", ".loom/specs/posts.resource.json"]);
    expect(validatedResource.output).toContain("Resource spec valid: posts");

    await expectTargetCommand([
      "make",
      "resource",
      "users",
      "--field",
      "id:uuid:readonly",
      "--field",
      "email:email:required",
      "--field",
      "name:string:required:min=2"
    ]);

    const routes = await expectTargetCommand(["routes"]);
    expect(routes.output).toContain("/users");
    expect(routes.output).toContain("audit-log");
    expect(routes.output).toContain("reports");

    const info = await expectTargetCommand(["info"]);
    expect(info.output).toContain("Modules: 4");

    await expectTargetCommand(["check"]);
    await expectTargetCommand(["r", "audit-log"]);
    await expectTargetCommand(["doctor", "--strict"]);
    await expectTargetCommand(["check"]);

    const resourceTest = await readFile(join(target, "tests", "modules", "users.test.ts"), "utf8");
    const skeleton = await readFile(join(target, ".loom", "context", "skeleton.md"), "utf8");
    const cleanedIndex = await readFile(join(target, "src", "index.ts"), "utf8");

    expect(resourceTest).toContain("users resource");
    expect(skeleton).toContain("usersController");
    expect(cleanedIndex).not.toContain("auditLogController");
  });
});

async function expectTargetCommand(args: string[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const code = await runLoom(args, {
    root: target,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message)
  });

  expect(code, `${args.join(" ")}\n${errors.join("\n")}`).toBe(0);

  return {
    output: logs.join("\n"),
    errors: errors.join("\n")
  };
}
