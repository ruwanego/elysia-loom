import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runLoom } from "../../src/loom";
import { createLoomFixture, cleanupLoomFixture, silentContext, runWithOutput } from "../helpers/fixtures";

let root = "";

beforeEach(async () => {
  root = await createLoomFixture();
});

afterEach(async () => {
  await cleanupLoomFixture(root);
});

describe("loom doctor", () => {
  test("doctor catches stale context, forbidden packages, and manual imports", async () => {
    const ctx = silentContext(root);

    expect(await runLoom(["generate", "module", "drift"], ctx)).toBe(0);
    expect(await runLoom(["test", "drift"], ctx)).toBe(0);
    expect(await runLoom(["sync"], ctx)).toBe(0);
    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(0);

    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    pkg.dependencies.zod = "latest";
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const forbiddenPackage = await runWithOutput(root, ["doctor"]);
    expect(forbiddenPackage.code).toBe(1);
    expect(forbiddenPackage.errors).toContain("Forbidden package dependency detected: zod");

    delete pkg.dependencies.zod;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const servicePath = join(root, "src", "modules", "drift", "drift.service.ts");
    const service = await readFile(servicePath, "utf8");
    await writeFile(servicePath, `${service}\nexport const manualSignatureDrift = true;\n`);

    const staleContext = await runWithOutput(root, ["doctor"]);
    expect(staleContext.code).toBe(1);
    expect(staleContext.errors).toContain(".loom/context/skeleton.md is stale");
    expect(staleContext.errors).toContain(".loom/context/skeleton.json is stale");

    await writeFile(servicePath, service);
    expect(await runLoom(["sync"], ctx)).toBe(0);

    const indexPath = join(root, "src", "index.ts");
    const index = await readFile(indexPath, "utf8");
    await writeFile(indexPath, `import { rogue } from './modules/rogue';\n${index}`);

    const manualImport = await runWithOutput(root, ["doctor", "--strict"]);
    expect(manualImport.code).toBe(1);
    expect(manualImport.errors).toContain("Manual module import detected");
  });
});
