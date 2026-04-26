#!/usr/bin/env bun
/**
 * LOOM INSTALLER
 * Bootstraps Loom into a fresh or existing Bun/Elysia project.
 */

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type InstallOptions = {
  target: string;
  force: boolean;
  dryRun: boolean;
  health: boolean;
  json: boolean;
  runCommands: boolean;
  log: (message: string) => void;
};

type ParsedArgs = {
  target: string;
  force: boolean;
  dryRun: boolean;
  health: boolean;
  json: boolean;
};

const SOURCE_ROOT = resolve(import.meta.dir, "..");
const TEMPLATE_ROOT = join(SOURCE_ROOT, "templates", "default");

const TEMPLATE_COPY_PATHS = [
  ".loom/AGENT.md",
  ".loom/manifest.json",
  "AGENT.md",
  "AGENTS.md",
  ".githooks/pre-push",
  ".github/workflows/loom.yml"
];

const DIST_COPY_PATHS: Array<{ from: string; to: string }> = [
  { from: "dist/loom.js", to: "scripts/loom.js" }
];

class InstallError extends Error {}

export async function installLoom(options: Partial<InstallOptions> & { target: string }) {
  const config: InstallOptions = {
    force: false,
    dryRun: false,
    health: false,
    json: true,
    runCommands: true,
    log: console.log,
    ...options,
    target: resolve(options.target)
  };

  await assertProjectTarget(config.target);
  await ensureBaseDirectories(config);
  await copyLoomFiles(config);
  await updatePackageJson(config);
  await ensureAnchors(config);

  if (config.runCommands && !config.dryRun) {
    if (config.health) {
      await runTargetCommand(config, ["bun", "loom", "make", "module", "health"]);
      await runTargetCommand(config, ["bun", "loom", "test", "health"]);
    }

    await runTargetCommand(config, config.json ? ["bun", "loom", "sync"] : ["bun", "loom", "s"]);
    await runTargetCommand(config, ["bun", "loom", "check"]);
  }

  config.log(`Loom installed in ${config.target}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const target = argv.find((arg) => !arg.startsWith("-")) ?? ".";
  const has = (flag: string) => argv.includes(flag);

  return {
    target,
    force: has("--force"),
    dryRun: has("--dry-run") || has("-n"),
    health: has("--health") || has("--with-health"),
    json: !has("--no-json")
  };
}

function printHelp() {
  console.log(`
LOOM INSTALLER
Usage:
  bunx elysia-loom <target> [flags]
  bun run loom:install <target> [flags]

Flags:
  --health, --with-health  Generate health module and tests after install
  --no-json                Generate only Markdown context on first sync
  --force                  Overwrite existing Loom files in target
  --dry-run, -n            Print planned writes without changing files
`);
}

async function assertProjectTarget(target: string) {
  if (!(await pathExists(join(target, "package.json")))) {
    throw new InstallError(`Target must contain package.json: ${target}`);
  }
}

async function ensureBaseDirectories(config: InstallOptions) {
  for (const path of [
    ".loom/context",
    ".githooks",
    ".github/workflows",
    "scripts",
    "src/modules",
    "tests/modules"
  ]) {
    await makeDir(config, join(config.target, path));
  }
}

async function copyLoomFiles(config: InstallOptions) {
  for (const relativePath of TEMPLATE_COPY_PATHS) {
    await copyProjectFile(config, TEMPLATE_ROOT, relativePath);
  }

  for (const { from, to } of DIST_COPY_PATHS) {
    await copyDistFile(config, from, to);
  }
}

async function updatePackageJson(config: InstallOptions) {
  const path = join(config.target, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));
  const scripts = { ...(pkg.scripts ?? {}) };

  scripts.loom = "bun run scripts/loom.js";
  scripts["loom:check"] = "bun loom check";
  scripts["hooks:install"] = "git config core.hooksPath .githooks";

  if (!scripts.test) {
    scripts.test = "bun test";
  }

  if (!scripts.check) {
    scripts.check = "bun run loom:check";
  }

  if (!scripts.prepare) {
    scripts.prepare = "bun run hooks:install";
  } else if (!scripts.prepare.includes("hooks:install")) {
    scripts.prepare = `bun run hooks:install && ${scripts.prepare}`;
  }

  if (!pkg.dependencies?.elysia && !pkg.devDependencies?.elysia) {
    pkg.dependencies = { ...(pkg.dependencies ?? {}), elysia: "latest" };
  }

  pkg.scripts = scripts;
  await writeText(config, path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function ensureAnchors(config: InstallOptions) {
  const indexPath = join(config.target, "src/index.ts");
  let content = await readTextIfExists(indexPath);

  if (!content) {
    content = `import { Elysia } from 'elysia';
// [LOOM_IMPORT_ANCHOR]

const app = new Elysia()
  .get('/', () => 'Loom Active')
  // [LOOM_MODULE_ANCHOR]
  .listen(3000);

console.log(\`Elysia running at \${app.server?.hostname}:\${app.server?.port}\`);
`;
    await writeText(config, indexPath, content);
    return;
  }

  if (!content.includes("// [LOOM_IMPORT_ANCHOR]")) {
    content = insertImportAnchor(content);
  }

  if (!content.includes("// [LOOM_MODULE_ANCHOR]")) {
    content = insertModuleAnchor(content);
  }

  await writeText(config, indexPath, content);
}

function insertImportAnchor(content: string) {
  const lines = content.split(/\r?\n/);
  let lastImportIndex = -1;

  for (const [index, line] of lines.entries()) {
    if (line.trim().startsWith("import ")) {
      lastImportIndex = index;
    }
  }

  if (lastImportIndex === -1) {
    return `// [LOOM_IMPORT_ANCHOR]\n${content}`;
  }

  lines.splice(lastImportIndex + 1, 0, "// [LOOM_IMPORT_ANCHOR]");
  return lines.join("\n");
}

function insertModuleAnchor(content: string) {
  if (!content.includes(".listen(")) {
    throw new InstallError("src/index.ts must contain .listen(...) or an existing // [LOOM_MODULE_ANCHOR].");
  }

  const lines = content.split(/\r?\n/);
  const listenLineIndex = lines.findIndex((line) => line.includes(".listen("));

  if (listenLineIndex >= 0 && lines[listenLineIndex].trim().startsWith(".listen(")) {
    const indent = lines[listenLineIndex].match(/^\s*/)?.[0] ?? "";
    lines.splice(listenLineIndex, 0, `${indent}// [LOOM_MODULE_ANCHOR]`);
    return lines.join("\n");
  }

  return content.replace(".listen(", "\n  // [LOOM_MODULE_ANCHOR]\n  .listen(");
}

async function copyProjectFile(config: InstallOptions, sourceRoot: string, relativePath: string) {
  const source = join(sourceRoot, relativePath);
  const target = join(config.target, relativePath);

  if (!config.force && await pathExists(target)) {
    throw new InstallError(`Refusing to overwrite existing file without --force: ${relativePath}`);
  }

  if (config.dryRun) {
    config.log(`[dry-run] copy ${relativePath}`);
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyDistFile(config: InstallOptions, from: string, to: string) {
  const source = join(SOURCE_ROOT, from);
  const target = join(config.target, to);

  if (!config.force && await pathExists(target)) {
    throw new InstallError(`Refusing to overwrite existing file without --force: ${to}`);
  }

  if (config.dryRun) {
    config.log(`[dry-run] copy ${from} -> ${to}`);
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function runTargetCommand(config: InstallOptions, command: string[]) {
  config.log(`> ${command.join(" ")}`);
  const process = Bun.spawn(command, {
    cwd: config.target,
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await process.exited;

  if (code !== 0) {
    throw new InstallError(`Command failed (${code}): ${command.join(" ")}`);
  }
}

async function makeDir(config: InstallOptions, path: string) {
  if (config.dryRun) {
    config.log(`[dry-run] mkdir ${path}`);
    return;
  }

  await mkdir(path, { recursive: true });
}

async function writeText(config: InstallOptions, path: string, content: string) {
  if (config.dryRun) {
    config.log(`[dry-run] write ${path}`);
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function readTextIfExists(path: string) {
  if (!(await pathExists(path))) {
    return undefined;
  }

  return await readFile(path, "utf8");
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
      printHelp();
      process.exit(0);
    }

    await installLoom(parseArgs(Bun.argv.slice(2)));
  } catch (error) {
    if (error instanceof InstallError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }
}
