/**
 * LOOM FILE SYSTEM
 * I/O wrappers, file scanning, and child process execution.
 */

import { Glob } from "bun";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MODULES_PATH } from "./constants";
import { normalizeSlash } from "./utils";
import type { LoomContext } from "./types";

export function resolvePath(ctx: LoomContext, path: string) {
  return join(ctx.root, path);
}

export async function pathExists(ctx: LoomContext, path: string) {
  try {
    await stat(resolvePath(ctx, path));
    return true;
  } catch {
    return false;
  }
}

export async function readText(ctx: LoomContext, path: string) {
  return await Bun.file(resolvePath(ctx, path)).text();
}

export async function readTextIfExists(ctx: LoomContext, path: string) {
  if (!(await pathExists(ctx, path))) {
    return undefined;
  }

  return await readText(ctx, path);
}

export async function readJsonIfExists<T>(ctx: LoomContext, path: string) {
  const content = await readTextIfExists(ctx, path);

  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

export async function makeDir(ctx: LoomContext, path: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] mkdir ${path}`);
    return;
  }

  await mkdir(resolvePath(ctx, path), { recursive: true });
}

export async function removePath(ctx: LoomContext, path: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] remove ${path}`);
    return;
  }

  await rm(resolvePath(ctx, path), { recursive: true, force: true });
}

export async function writeText(ctx: LoomContext, path: string, content: string) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] write ${path}`);
    return;
  }

  const absolutePath = resolvePath(ctx, path);
  const parent = dirname(absolutePath);

  if (parent !== ".") {
    await mkdir(parent, { recursive: true });
  }

  await Bun.write(absolutePath, content);
}

export async function scanTs(ctx: LoomContext, pattern: string) {
  const glob = new Glob(pattern);
  const paths: string[] = [];

  for await (const path of glob.scan(ctx.root)) {
    paths.push(normalizeSlash(path));
  }

  return paths.sort();
}

export async function scanProjectFiles(ctx: LoomContext) {
  const paths: string[] = [];
  const scanner = ctx.root === "."
    ? new Glob("src/**/*.ts").scan(".")
    : new Glob("src/**/*.ts").scan(ctx.root);

  for await (const path of scanner) {
    paths.push(normalizeSlash(path));
  }

  return paths.sort();
}

export async function hasBunTestFiles(ctx: LoomContext) {
  const patterns = [
    "tests/**/*.test.ts",
    "tests/**/*.spec.ts",
    "test/**/*.test.ts",
    "test/**/*.spec.ts"
  ];

  for (const pattern of patterns) {
    const glob = new Glob(pattern);

    for await (const _path of glob.scan(ctx.root)) {
      return true;
    }
  }

  return false;
}

export async function listModuleNames(ctx: LoomContext) {
  try {
    const entries = await readdir(resolvePath(ctx, MODULES_PATH), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function runChildCommand(ctx: LoomContext, command: string[]) {
  if (ctx.dryRun) {
    ctx.log(`[dry-run] ${command.join(" ")}`);
    return 0;
  }

  const process = Bun.spawn(command, {
    cwd: ctx.root,
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await process.exited;

  if (code !== 0) {
    ctx.error(`Command failed (${code}): ${command.join(" ")}`);
  }

  return code;
}
