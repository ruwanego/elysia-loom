/**
 * LOOM TEST FIXTURES
 * Shared test infrastructure for all Loom test files.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoom } from "../../src/loom";

const AGENT_PROTOCOL = `# Optimized Loom Protocol

- bun loom generate module <name>
- bun loom generate resource <name> --field <name:type>
- bun loom generate guard <name>
- bun loom generate middleware <name>
- bun loom generate hook <name>
- bun loom generate plugin <name>
- bun loom init swagger
- bun loom init env
- bun loom init auth
- bun loom init observability
- bun loom plan resource <name>
- bun loom validate resource <name>
- bun loom sync
- bun loom check
- bun loom routes
- bun loom info
- bun loom route <module> <method> <path>
- bun loom test <module>
- bun loom brief
- bun loom inspect <module>
- bun loom skeleton
- bun loom skeleton --json
- bun loom doctor
- bun loom doctor --strict
`;

const INDEX_TEMPLATE = `import { Elysia } from 'elysia';
// [LOOM_IMPORT_ANCHOR]

const app = new Elysia()
  .get('/', () => 'Loom Active')
  // [LOOM_MODULE_ANCHOR]
  .listen(3000);

export type App = typeof app;
`;

export async function createLoomFixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-test-"));
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
  await writeFile(join(root, ".loom", "AGENT.md"), AGENT_PROTOCOL);
  await writeFile(join(root, "AGENT.md"), AGENT_PROTOCOL);
  await writeFile(join(root, "AGENTS.md"), AGENT_PROTOCOL);
  await writeFile(join(root, "src", "index.ts"), INDEX_TEMPLATE);

  return root;
}

export async function cleanupLoomFixture(root: string) {
  await rm(root, { recursive: true, force: true });
}

export function silentContext(root: string) {
  return {
    root,
    log: () => undefined,
    error: () => undefined
  };
}

export async function runWithOutput(root: string, args: string[]) {
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
