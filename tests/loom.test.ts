import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoom } from "../src/loom";

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

- bun loom make module <name>
- bun loom make resource <name> --field <name:type>
- bun loom make guard <name>
- bun loom make middleware <name>
- bun loom make hook <name>
- bun loom make plugin <name>
- bun loom init swagger
- bun loom plan resource <name>
- bun loom validate resource <name>
- bun loom sync
- bun loom check
- bun loom routes
- bun loom info
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

  test("generates, audits, and removes core artifacts and initializes swagger", async () => {
    const ctx = silentContext();

    expect(await runLoom(["make", "guard", "auth"], ctx)).toBe(0);
    expect(await runLoom(["make", "middleware", "logger"], ctx)).toBe(0);
    expect(await runLoom(["make", "hook", "on-error"], ctx)).toBe(0);
    expect(await runLoom(["make", "plugin", "db"], ctx)).toBe(0);
    expect(await runLoom(["init", "swagger"], ctx)).toBe(0);

    const guard = await readFile(join(root, "src", "core", "guards", "auth.guard.ts"), "utf8");
    expect(guard).toContain("export const authGuard = new Elysia({ name: 'guard/auth' })");
    expect(guard).toContain("@loom-generated");

    const guardTest = await readFile(join(root, "tests", "core", "auth.guard.test.ts"), "utf8");
    expect(guardTest).toContain("describe(\"auth guard\"");

    const swaggerIndex = await readFile(join(root, "src", "index.ts"), "utf8");
    expect(swaggerIndex).toContain("import { swagger } from '@elysiajs/swagger';");
    expect(swaggerIndex).toContain(".use(swagger())");

    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.dependencies["@elysiajs/swagger"]).toBeDefined();

    expect(await runLoom(["doctor"], ctx)).toBe(0);

    expect(await runLoom(["r", "guard", "auth"], ctx)).toBe(0);
    await expect(readFile(join(root, "src", "core", "guards", "auth.guard.ts"), "utf8")).rejects.toThrow();
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

  test("generates typed resources from field specs", async () => {
    const ctx = silentContext();

    expect(await runLoom([
      "make",
      "resource",
      "users",
      "--field",
      "id:uuid:readonly",
      "--field",
      "email:email:required",
      "--field",
      "name:string:required:min=2:max=80",
      "--field",
      "age:integer:optional:min=0",
      "--field",
      "role:enum(admin,user):required"
    ], ctx)).toBe(0);

    const schema = await readFile(join(root, "src", "modules", "users", "users.schema.ts"), "utf8");
    const service = await readFile(join(root, "src", "modules", "users", "users.service.ts"), "utf8");
    const controller = await readFile(join(root, "src", "modules", "users", "users.controller.ts"), "utf8");
    const generatedTest = await readFile(join(root, "tests", "modules", "users.test.ts"), "utf8");
    const index = await readFile(join(root, "src", "index.ts"), "utf8");

    expect(schema).toContain("export const UsersSchema = t.Object");
    expect(schema).toContain("export const CreateUsersSchema = t.Object");
    expect(schema).toContain("export const UpdateUsersSchema = t.Object");
    expect(schema).toContain("export const UsersErrorSchema = t.Object");
    expect(schema).toContain("email: t.String({ format: 'email' })");
    expect(schema).toContain("age: t.Optional(t.Integer({ minimum: 0 }))");
    expect(schema).toContain("role: t.Union([t.Literal('admin'), t.Literal('user')])");
    expect(service).toContain("list(): Users[]");
    expect(service).toContain("return [...usersStore]");
    expect(service).toContain("crypto.randomUUID() as Users[\"id\"]");
    expect(service).toContain("create(input: CreateUsersInput): Users");
    expect(service).toContain("update(id: UsersParams[\"id\"], input: UpdateUsersInput): Users | undefined");
    expect(service).toContain("usersStore[index] = next");
    expect(service).toContain("usersStore.splice(index, 1)");
    expect(controller).toContain("new Elysia({ prefix: '/users' })");
    expect(controller).toContain(".post('/'");
    expect(controller).toContain("body: CreateUsersSchema");
    expect(controller).toContain("status(404, { error: 'Users not found' })");
    expect(controller).toContain(".delete('/:id'");
    expect(generatedTest).toContain("const createPayload: CreateUsersInput");
    expect(generatedTest).toContain("POST /users validates body");
    expect(index).toContain("usersController");
    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(0);
  });

  test("plans and validates resources from spec files", async () => {
    await mkdir(join(root, ".loom", "specs"), { recursive: true });
    await writeFile(
      join(root, ".loom", "specs", "posts.resource.json"),
      JSON.stringify({
        route: "/posts",
        fields: [
          "title:string:required:min=2",
          { name: "published", type: "boolean", optional: true }
        ]
      }, null, 2)
    );

    const validateLogs: string[] = [];
    expect(await runLoom(["validate", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], {
      root,
      log: (message) => validateLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(validateLogs.join("\n")).toContain("Resource spec valid: posts");
    expect(validateLogs.join("\n")).toContain("Fields: id, title, published");

    const planLogs: string[] = [];
    expect(await runLoom(["plan", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], {
      root,
      log: (message) => planLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(planLogs.join("\n")).toContain("[dry-run] write src/modules/posts/posts.schema.ts");
    await expect(readFile(join(root, "src", "modules", "posts", "posts.schema.ts"), "utf8")).rejects.toThrow();

    expect(await runLoom(["make", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], silentContext())).toBe(0);
    const schema = await readFile(join(root, "src", "modules", "posts", "posts.schema.ts"), "utf8");
    expect(schema).toContain("title: t.String({ minLength: 2 })");
    expect(schema).toContain("published: t.Optional(t.Boolean())");
  });

  test("supports alpha target commands", async () => {
    const ctx = silentContext();

    expect(await runLoom(["make", "module", "alpha"], ctx)).toBe(0);
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

    const listLogs: string[] = [];
    expect(await runLoom(["list"], {
      root,
      log: (message) => listLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(listLogs.join("\n")).toContain("make resource <name>");
  });

  test("check skips bun test when target has no test files", async () => {
    const logs: string[] = [];

    expect(await runLoom(["sync"], silentContext())).toBe(0);
    expect(await runLoom(["check"], {
      root,
      log: (message) => logs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(logs.join("\n")).toContain("Loom doctor --strict passed.");
    expect(logs.join("\n")).toContain("No Bun tests found; skipping bun test.");
  });

  test("rejects invalid commands, fields, routes, and resource specs", async () => {
    const missingField = await runWithOutput(["make", "resource", "invalid-resource"]);
    expect(missingField.code).toBe(1);
    expect(missingField.errors).toContain("requires at least one --field");

    const badId = await runWithOutput(["make", "resource", "bad-id", "--field", "id:boolean:readonly"]);
    expect(badId.code).toBe(1);
    expect(badId.errors).toContain("Resource id field must use uuid");

    const badConstraint = await runWithOutput(["make", "resource", "bad-range", "--field", "name:string:min=10:max=1"]);
    expect(badConstraint.code).toBe(1);
    expect(badConstraint.errors).toContain("min greater than max");

    const badRoute = await runWithOutput(["make", "resource", "bad-route", "--field", "name:string", "--route", "bad path"]);
    expect(badRoute.code).toBe(1);
    expect(badRoute.errors).toContain("Resource route prefix must start with /");

    const missingFlag = await runWithOutput(["make", "resource", "missing-flag", "--field"]);
    expect(missingFlag.code).toBe(1);
    expect(missingFlag.errors).toContain("Missing value for --field");

    const unsupportedRoute = await runWithOutput(["route", "missing", "trace", "/x"]);
    expect(unsupportedRoute.code).toBe(1);
    expect(unsupportedRoute.errors).toContain("Unsupported HTTP method");

    const unknown = await runWithOutput(["unknown"]);
    expect(unknown.code).toBe(1);
    expect(unknown.logs).toContain("LOOM CLI");

    const version = await runWithOutput(["--version"]);
    expect(version.code).toBe(0);
    expect(version.logs).toMatch(/\d+\.\d+\.\d+/);
  });

  test("doctor catches stale context, forbidden packages, and manual imports", async () => {
    const ctx = silentContext();

    expect(await runLoom(["g", "drift"], ctx)).toBe(0);
    expect(await runLoom(["test", "drift"], ctx)).toBe(0);
    expect(await runLoom(["sync"], ctx)).toBe(0);
    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(0);

    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    pkg.dependencies.zod = "latest";
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const forbiddenPackage = await runWithOutput(["doctor"]);
    expect(forbiddenPackage.code).toBe(1);
    expect(forbiddenPackage.errors).toContain("Forbidden package dependency detected: zod");

    delete pkg.dependencies.zod;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const servicePath = join(root, "src", "modules", "drift", "drift.service.ts");
    const service = await readFile(servicePath, "utf8");
    await writeFile(servicePath, `${service}\nexport const manualSignatureDrift = true;\n`);

    const staleContext = await runWithOutput(["doctor"]);
    expect(staleContext.code).toBe(1);
    expect(staleContext.errors).toContain(".loom/context/skeleton.md is stale");
    expect(staleContext.errors).toContain(".loom/context/skeleton.json is stale");

    await writeFile(servicePath, service);
    expect(await runLoom(["sync"], ctx)).toBe(0);

    const indexPath = join(root, "src", "index.ts");
    const index = await readFile(indexPath, "utf8");
    await writeFile(indexPath, `import { rogue } from './modules/rogue';\n${index}`);

    const manualImport = await runWithOutput(["doctor", "--strict"]);
    expect(manualImport.code).toBe(1);
    expect(manualImport.errors).toContain("Manual module import detected");
  });
});

function silentContext() {
  return {
    root,
    log: () => undefined,
    error: () => undefined
  };
}

async function runWithOutput(args: string[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const code = await runLoom(args, {
    root,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message)
  });

  return {
    code,
    logs: logs.join("\n"),
    errors: errors.join("\n")
  };
}
