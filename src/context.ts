/**
 * LOOM CONTEXT
 * Skeleton, brief, and context generation with source-code parsing.
 */

import {
  BRIEF_PATH,
  ENTRY_PATH,
  MANIFEST_PATH,
  MODULES_PATH,
  SKELETON_JSON_PATH,
  SKELETON_MD_PATH,
  moduleFiles,
  moduleTestPath
} from "./constants";
import {
  listModuleNames,
  pathExists,
  readJsonIfExists,
  readText,
  readTextIfExists,
  scanProjectFiles,
  writeText
} from "./fs";
import { normalizeSlash, normalizeModuleName } from "./utils";
import type {
  ControllerImport,
  LoomContext,
  RouteSignature,
  SkeletonContext,
  SkeletonFile,
  SkeletonModule
} from "./types";
import { ANCHORS, createContext } from "./types";

export async function syncContext(ctx: LoomContext = createContext()) {
  await refreshSkeleton({ ...ctx, emitJson: true });
}

export async function refreshSkeleton(ctx: LoomContext = createContext()) {
  const output = await createSkeletonOutput(ctx);
  const emitJson = ctx.emitJson || await pathExists(ctx, SKELETON_JSON_PATH);

  await writeText(ctx, BRIEF_PATH, await createBrief(ctx, output));
  await writeText(ctx, SKELETON_MD_PATH, output.markdown);

  if (emitJson) {
    await writeText(ctx, SKELETON_JSON_PATH, `${JSON.stringify(output.json, null, 2)}\n`);
  }

  const paths = emitJson
    ? `${SKELETON_MD_PATH} and ${SKELETON_JSON_PATH}`
    : SKELETON_MD_PATH;

  ctx.log(`Skeleton map ${ctx.dryRun ? "planned" : "updated"} in ${paths}`);
}

export async function refreshBrief(ctx: LoomContext = createContext()) {
  const output = await createSkeletonOutput(ctx);
  await writeText(ctx, BRIEF_PATH, await createBrief(ctx, output));
  ctx.log(`Brief context ${ctx.dryRun ? "planned" : "updated"} in ${BRIEF_PATH}`);
}

export async function createSkeleton(ctx: LoomContext = createContext(), generatedAt = new Date().toISOString()) {
  return (await createSkeletonOutput(ctx, generatedAt)).markdown;
}

export async function createSkeletonOutput(ctx: LoomContext = createContext(), generatedAt = new Date().toISOString()) {
  const paths = await scanProjectFiles(ctx);
  const entry = await readTextIfExists(ctx, ENTRY_PATH);
  const registrations = entry ? parseControllerImports(entry) : [];
  const registeredNames = new Set(registrations.map((registration) => registration.moduleName));
  const files: SkeletonFile[] = [];
  const modules: SkeletonModule[] = [];
  let markdown = `# PROJECT SKELETON MAP\nGenerated: ${generatedAt}\n\n`;

  for (const path of paths) {
    const content = await readText(ctx, path);
    const skeleton = buildSkeletonLines(content);

    if (skeleton.length === 0) {
      continue;
    }

    files.push({
      path,
      imports: skeleton.filter((line) => line.startsWith("import ")),
      exports: skeleton.filter((line) => line.startsWith("export ")),
      routes: extractRoutes(content),
      uses: extractUses(content),
      skeleton
    });

    markdown += `### File: ${path}\n\`\`\`typescript\n${skeleton.join("\n")}\n\`\`\`\n\n`;
  }

  for (const name of await listModuleNames(ctx)) {
    const filesForModule = moduleFiles(name);
    const controller = await readTextIfExists(ctx, filesForModule.controller);
    const prefix = controller ? extractPrefix(controller) ?? `/${name}` : `/${name}`;

    modules.push({
      name,
      prefix,
      files: {
        controller: await pathExists(ctx, filesForModule.controller),
        service: await pathExists(ctx, filesForModule.service),
        schema: await pathExists(ctx, filesForModule.schema)
      },
      registered: registeredNames.has(name),
      routes: controller ? extractRoutes(controller) : []
    });
  }

  return {
    markdown,
    json: {
      generatedAt,
      anchors: ANCHORS,
      registrations,
      modules,
      files
    }
  };
}

export async function createBrief(
  ctx: LoomContext = createContext(),
  output: Awaited<ReturnType<typeof createSkeletonOutput>> | undefined = undefined,
  generatedAt = new Date().toISOString()
) {
  const skeleton = output ?? await createSkeletonOutput(ctx, generatedAt);
  const manifest = await readJsonIfExists<Record<string, string>>(ctx, MANIFEST_PATH);
  const runtime = manifest?.runtime ?? "unknown";
  const framework = manifest?.framework ?? "unknown";
  const schema = manifest?.schema ?? "unknown";
  const pattern = manifest?.pattern ?? "unknown";
  const lines = [
    "# LOOM BRIEF",
    `Generated: ${skeleton.json.generatedAt}`,
    "",
    `Stack: ${runtime}/${framework}/${schema}/${pattern}`,
    "Read: brief first; then skeleton.md OR skeleton.json, not both.",
    "TDD: write/generate tests before behavior changes; strict doctor requires module tests.",
    "CLI: make module | make resource --field | plan | validate | sync | check | routes | info | g | route | test | s | s --json | brief | inspect | doctor | doctor --strict",
    "",
    "Modules:"
  ];

  if (skeleton.json.modules.length === 0) {
    lines.push("- none");
  }

  for (const module of skeleton.json.modules) {
    const hasTest = await pathExists(ctx, moduleTestPath(module.name));
    lines.push(`- ${module.name} ${module.prefix} test:${hasTest ? "yes" : "no"} registered:${module.registered ? "yes" : "no"}`);

    for (const route of module.routes) {
      const response = route.response ? ` -> ${route.response}` : "";
      lines.push(`  ${route.method.toUpperCase()} ${route.path}${response}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function buildSkeletonLines(content: string) {
  const sourceLines = content.split("\n");
  const output: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const trimmed = sourceLines[index].trim();

    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }

    if (trimmed.startsWith("import ")) {
      output.push(trimmed);
      continue;
    }

    if (/^export const \w+Schema = t\.Object\(\{/.test(trimmed)) {
      const { block, nextIndex } = collectUntil(sourceLines, index, (line) => line.trim() === "});");
      output.push(...block.map((line) => line.trimEnd()));
      index = nextIndex;
      continue;
    }

    if (trimmed.startsWith("export type ") || trimmed.startsWith("export interface ")) {
      output.push(stripTrailingBody(trimmed));
      continue;
    }

    if (/^export const \w+Controller = new Elysia/.test(trimmed)) {
      output.push(trimmed);
      continue;
    }

    if (trimmed.startsWith("export ")) {
      output.push(stripExportBody(trimmed));
      continue;
    }

    if (isRouteStart(trimmed)) {
      const { block, nextIndex } = collectRouteBlock(sourceLines, index);
      output.push(...summarizeRouteBlock(block));
      index = nextIndex;
      continue;
    }

    if (trimmed.startsWith(".use(")) {
      output.push(trimmed);
      continue;
    }

    if (/^[A-Za-z_$][\w$]*\([^)]*\)\s*(:\s*[^={]+)?\s*\{?$/.test(trimmed)) {
      output.push(stripTrailingBody(trimmed));
    }
  }

  return output;
}

function collectUntil(lines: string[], startIndex: number, isEnd: (line: string) => boolean) {
  const block: string[] = [];
  let nextIndex = startIndex;

  for (let index = startIndex; index < lines.length; index += 1) {
    block.push(lines[index]);
    nextIndex = index;

    if (isEnd(lines[index])) {
      break;
    }
  }

  return { block, nextIndex };
}

function collectRouteBlock(lines: string[], startIndex: number) {
  const block: string[] = [lines[startIndex]];
  let nextIndex = startIndex;
  const start = lines[startIndex].trim();

  if (start.endsWith(")") || start.endsWith(");")) {
    return { block, nextIndex };
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    block.push(lines[index]);
    nextIndex = index;

    if (/^\}\)[,;]?$/.test(trimmed) || /^\)[,;]?$/.test(trimmed) || /^\}\);$/.test(trimmed)) {
      break;
    }
  }

  return { block, nextIndex };
}

function summarizeRouteBlock(block: string[]) {
  const route = parseRouteBlock(block);

  if (!route) {
    return block.map((line) => line.trim());
  }

  const lines = [`.${route.method}('${route.path}', <handler>${hasRouteOptions(route) ? ", {" : ")"}`];
  const optionLines: string[] = [];

  for (const key of ["body", "query", "params", "headers", "response"] as const) {
    if (route[key]) {
      optionLines.push(`  ${key}: ${route[key]}`);
    }
  }

  if (route.detail) {
    optionLines.push(`  detail: ${route.detail}`);
  } else if (route.summary) {
    optionLines.push(`  detail: { summary: '${route.summary}' }`);
  }

  for (const [index, line] of optionLines.entries()) {
    lines.push(index === optionLines.length - 1 ? line : `${line},`);
  }

  if (hasRouteOptions(route)) {
    lines.push("})");
  }

  return lines;
}

function parseRouteBlock(block: string[]): RouteSignature | undefined {
  const text = block.map((line) => line.trim()).join(" ");
  const match = text.match(/^\.(get|post|put|patch|delete|options|head)\(\s*['"`]([^'"`]+)['"`]/);

  if (!match) {
    return undefined;
  }

  return {
    method: match[1],
    path: match[2],
    body: extractRouteOption(text, "body"),
    query: extractRouteOption(text, "query"),
    params: extractRouteOption(text, "params"),
    headers: extractRouteOption(text, "headers"),
    response: extractRouteOption(text, "response"),
    detail: extractObjectOption(text, "detail"),
    summary: extractSummary(text)
  };
}

function extractRouteOption(text: string, key: string) {
  const match = text.match(new RegExp(`${key}:\\s*([^,}]+)`));
  return match?.[1]?.trim();
}

function extractObjectOption(text: string, key: string) {
  const match = text.match(new RegExp(`${key}:\\s*(\\{.*?\\})\\s*[,}]`));
  return match?.[1]?.trim();
}

function extractSummary(text: string) {
  const match = text.match(/summary:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1];
}

function hasRouteOptions(route: RouteSignature) {
  return Boolean(route.body || route.query || route.params || route.headers || route.response || route.detail || route.summary);
}

export function extractRoutes(content: string) {
  const lines = content.split("\n");
  const routes: RouteSignature[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!isRouteStart(lines[index].trim())) {
      continue;
    }

    const { block, nextIndex } = collectRouteBlock(lines, index);
    const route = parseRouteBlock(block);

    if (route) {
      routes.push(route);
    }

    index = nextIndex;
  }

  return routes;
}

export function extractUses(content: string) {
  return [...content.matchAll(/^\s*\.use\((\w+)\)/gm)].map((match) => match[1]);
}

export function parseControllerImports(content: string): ControllerImport[] {
  return [...content.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/modules\/([^'"]+)\/([^'"]+)\.controller['"];?/gm)]
    .map((match) => ({
      controllerName: match[1],
      moduleName: normalizeSlash(match[2]),
      path: normalizeSlash(`${MODULES_PATH}/${match[2]}/${match[3]}.controller.ts`)
    }));
}

export function extractPrefix(content: string) {
  return content.match(/new Elysia\(\{\s*prefix:\s*['"`]([^'"`]+)['"`]/)?.[1];
}

export function isRouteStart(trimmed: string) {
  return /^\.(get|post|put|patch|delete|options|head)\(/.test(trimmed);
}

function stripExportBody(line: string) {
  const assignmentIndex = line.indexOf(" = ");

  if (assignmentIndex === -1) {
    return stripTrailingBody(line);
  }

  return line.slice(0, assignmentIndex);
}

function stripTrailingBody(line: string) {
  return line.replace(/\s*\{\s*$/, "").replace(/\s*;\s*$/, "");
}
