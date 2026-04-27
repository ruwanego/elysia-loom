import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const loomNodeModules = join(repoRoot, "node_modules");
const tmpRoot = join(repoRoot, ".tmp", "blackbox-tests");

let target = "";

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
  target = await mkdtemp(join(tmpRoot, "dev-flow-"));
  await mkdir(join(target, "src"), { recursive: true });

  await writeFile(
    join(target, "package.json"),
    JSON.stringify({
      name: "loom-blackbox-fixture",
      private: true,
      scripts: {
        dev: "bun run --watch src/index.ts"
      }
    }, null, 2)
  );

  await writeFile(
    join(target, "src", "index.ts"),
    `import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/', () => 'hello from blackbox-flow')
  .listen(3000);

export type App = typeof app;
`
  );

  await symlink(loomNodeModules, join(target, "node_modules"), "junction");
});

afterEach(async () => {
  const resolvedTarget = resolve(target);
  const resolvedTmpRoot = `${resolve(tmpRoot)}${sep}`;

  if (resolvedTarget.startsWith(resolvedTmpRoot)) {
    await rm(resolvedTarget, { recursive: true, force: true });
  }
});

describe("blackbox dev flow", () => {
  test("simulates install -> inspect protocol -> scaffold -> evolve -> verify handoff", async () => {
    await runLoomInstaller([target, "--health"]);

    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    const rootAgent = await readFile(join(target, "AGENT.md"), "utf8");
    const projectAgent = await readFile(join(target, ".loom", "AGENT.md"), "utf8");
    const brief = await readFile(join(target, ".loom", "context", "brief.md"), "utf8");
    const skeleton = JSON.parse(await readFile(join(target, ".loom", "context", "skeleton.json"), "utf8"));

    expect(packageJson.scripts.loom).toBe("bun run scripts/loom.js");
    expect(rootAgent).toContain("Read `.loom/AGENT.md`.");
    expect(projectAgent).toContain("bun loom generate module <name>");
    expect(brief).toContain("LOOM BRIEF");
    expect(Array.isArray(skeleton.modules)).toBe(true);
    expect(skeleton.modules.some((module: { name: string; }) => module.name === "health")).toBe(true);

    const info = await runTargetCommand(["info"]);
    const routesBefore = await runTargetCommand(["routes"]);

    expect(info.stdout).toContain("LOOM INFO");
    expect(info.stdout).toContain("Modules: 1");
    expect(routesBefore.stdout).toContain("/health");

    await runTargetCommand(["init", "env"]);
    await runTargetCommand(["init", "auth"]);
    await runTargetCommand(["init", "observability"]);
    await runTargetCommand(["generate", "module", "billing"]);
    await runTargetCommand(["route", "billing", "post", "/charge"]);
    await runTargetCommand(["test", "billing"]);

    await mkdir(join(target, ".loom", "specs"), { recursive: true });
    await writeFile(
      join(target, ".loom", "specs", "invoices.resource.json"),
      JSON.stringify({
        route: "/invoices",
        fields: [
          "customerEmail:email:required",
          "amount:number:required:min=0",
          { name: "status", type: "enum(draft,paid)", optional: true }
        ]
      }, null, 2)
    );

    const plan = await runTargetCommand(["plan", "resource", "invoices", "--from", ".loom/specs/invoices.resource.json"]);
    const validate = await runTargetCommand(["validate", "resource", "invoices", "--from", ".loom/specs/invoices.resource.json"]);

    expect(plan.stdout).toContain("[dry-run] write src/modules/invoices/invoices.schema.ts");
    expect(validate.stdout).toContain("Resource spec valid: invoices");

    await runTargetCommand(["generate", "resource", "invoices", "--from", ".loom/specs/invoices.resource.json"]);
    await runTargetCommand(["inspect", "billing"]);
    await runTargetCommand(["sync"]);
    await runTargetCommand(["doctor", "--strict"]);
    await runTargetCommand(["check"]);

    const billingController = await readFile(join(target, "src", "modules", "billing", "billing.controller.ts"), "utf8");
    const billingService = await readFile(join(target, "src", "modules", "billing", "billing.service.ts"), "utf8");
    const billingTest = await readFile(join(target, "tests", "modules", "billing.test.ts"), "utf8");
    const envPlugin = await readFile(join(target, "src", "core", "plugins", "env.plugin.ts"), "utf8");
    const authGuard = await readFile(join(target, "src", "core", "guards", "auth.guard.ts"), "utf8");
    const loggerPlugin = await readFile(join(target, "src", "core", "plugins", "logger.plugin.ts"), "utf8");
    const invoicesSchema = await readFile(join(target, "src", "modules", "invoices", "invoices.schema.ts"), "utf8");
    const invoicesController = await readFile(join(target, "src", "modules", "invoices", "invoices.controller.ts"), "utf8");
    const invoicesService = await readFile(join(target, "src", "modules", "invoices", "invoices.service.ts"), "utf8");
    const invoicesTest = await readFile(join(target, "tests", "modules", "invoices.test.ts"), "utf8");
    const index = await readFile(join(target, "src", "index.ts"), "utf8");
    const updatedBrief = await readFile(join(target, ".loom", "context", "brief.md"), "utf8");
    const updatedSkeleton = JSON.parse(await readFile(join(target, ".loom", "context", "skeleton.json"), "utf8"));
    const routesAfter = await runTargetCommand(["routes"]);
    const finalInfo = await runTargetCommand(["info"]);

    expect(billingController).toContain("export const billingController");
    expect(billingController).toContain(".post('/charge'");
    expect(billingService).toContain("charge");
    expect(billingTest).toContain("billingController");
    expect(envPlugin).toContain("process.env.NODE_ENV ?? 'development'");
    expect(authGuard).toContain("Unauthorized");
    expect(loggerPlugin).toContain("requestMetaFrom");
    expect(invoicesSchema).toContain("customerEmail: t.String({ format: 'email' })");
    expect(invoicesSchema).toContain("amount: t.Number({ minimum: 0 })");
    expect(invoicesSchema).toContain("code: t.String()");
    expect(invoicesSchema).toContain("t.Literal('draft')");
    expect(invoicesController).toContain("new Elysia({ prefix: '/invoices' })");
    expect(invoicesController).toContain("set.status = 201");
    expect(invoicesController).toContain("code: 'NOT_FOUND'");
    expect(invoicesService).toContain("reset(): void");
    expect(invoicesTest).toContain("beforeEach(() => {");
    expect(invoicesTest).toContain("InvoicesService.reset()");
    expect(invoicesTest).toContain("PATCH /invoices/:id updates resource fields");
    expect(invoicesTest).toContain("data integrity lifecycle");
    expect(invoicesTest).toContain("POST /invoices rejects invalid body");
    expect(invoicesTest).toContain("DELETE /invoices/:id returns 404 for missing resource");
    expect(index).toContain("billingController");
    expect(index).toContain("invoicesController");
    expect(updatedBrief).toContain("billing /billing test:yes");
    expect(updatedBrief).toContain("invoices /invoices test:yes");
    expect(updatedSkeleton.modules.some((module: { name: string; }) => module.name === "billing")).toBe(true);
    expect(updatedSkeleton.modules.some((module: { name: string; }) => module.name === "invoices")).toBe(true);
    expect(routesAfter.stdout).toContain("/billing/charge");
    expect(routesAfter.stdout).toContain("/invoices");
    expect(finalInfo.stdout).toContain("Modules: 3");
    expect(finalInfo.stdout).toContain("Module tests: 3/3");
  });

  test("simulates a plan-first agent that validates specs before generation", async () => {
    await runLoomInstaller([target]);

    await mkdir(join(target, ".loom", "specs"), { recursive: true });
    await writeFile(
      join(target, ".loom", "specs", "projects.resource.json"),
      JSON.stringify({
        route: "/projects",
        fields: [
          "name:string:required:min=3:max=80",
          { name: "archived", type: "boolean", optional: true }
        ]
      }, null, 2)
    );

    const validate = await runTargetCommand(["validate", "resource", "projects", "--from", ".loom/specs/projects.resource.json"]);
    const plan = await runTargetCommand(["plan", "resource", "projects", "--from", ".loom/specs/projects.resource.json"]);

    expect(validate.stdout).toContain("Resource spec valid: projects");
    expect(validate.stdout).toContain("Fields: id, name, archived");
    expect(plan.stdout).toContain("[dry-run] write src/modules/projects/projects.schema.ts");

    await runTargetCommand(["generate", "resource", "projects", "--from", ".loom/specs/projects.resource.json"]);
    await runTargetCommand(["sync"]);
    await runTargetCommand(["doctor", "--strict"]);

    const schema = await readFile(join(target, "src", "modules", "projects", "projects.schema.ts"), "utf8");
    const generatedTest = await readFile(join(target, "tests", "modules", "projects.test.ts"), "utf8");
    const brief = await readFile(join(target, ".loom", "context", "brief.md"), "utf8");
    const routes = await runTargetCommand(["routes"]);
    const info = await runTargetCommand(["info"]);

    expect(schema).toContain("name: t.String({ minLength: 3, maxLength: 80 })");
    expect(schema).toContain("archived: t.Optional(t.Boolean())");
    expect(generatedTest).toContain("POST /projects validates body");
    expect(brief).toContain("projects /projects test:yes");
    expect(routes.stdout).toContain("/projects");
    expect(info.stdout).toContain("Modules: 1");
    expect(info.stdout).toContain("Module tests: 1/1");
  });

  test("simulates drift detection and recovery after manual edits", async () => {
    await runLoomInstaller([target]);

    await runTargetCommand(["generate", "module", "reports"]);
    await runTargetCommand(["test", "reports"]);
    await runTargetCommand(["sync"]);
    await runTargetCommand(["doctor", "--strict"]);

    const servicePath = join(target, "src", "modules", "reports", "reports.service.ts");
    const originalService = await readFile(servicePath, "utf8");
    await writeFile(servicePath, `${originalService}\nexport const manualSignatureDrift = true;\n`);

    const drift = await runTargetCommandExpectingFailure(["doctor"]);
    expect(drift.code).toBe(1);
    expect(drift.stderr).toContain(".loom/context/skeleton.md is stale");
    expect(drift.stderr).toContain(".loom/context/skeleton.json is stale");

    await writeFile(servicePath, originalService);
    await runTargetCommand(["sync"]);
    await runTargetCommand(["doctor", "--strict"]);

    const finalInfo = await runTargetCommand(["info"]);
    expect(finalInfo.stdout).toContain("Modules: 1");
    expect(finalInfo.stdout).toContain("Module tests: 1/1");
  });
});

async function runLoomInstaller(args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(repoRoot, "src", "installer.ts"), ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  expect(code, `installer failed\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`).toBe(0);

  return { stdout, stderr };
}

async function runTargetCommand(args: string[]) {
  const proc = Bun.spawn(["bun", "run", "scripts/loom.js", ...args], {
    cwd: target,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  expect(code, `command failed: bun loom ${args.join(" ")}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`).toBe(0);

  return { stdout, stderr, code };
}

async function runTargetCommandExpectingFailure(args: string[]) {
  const proc = Bun.spawn(["bun", "run", "scripts/loom.js", ...args], {
    cwd: target,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  expect(code, `expected failure but command passed: bun loom ${args.join(" ")}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`).not.toBe(0);

  return { stdout, stderr, code };
}
