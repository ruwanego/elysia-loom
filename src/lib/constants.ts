/**
 * LOOM CONSTANTS
 * Path constants, markers, and pure path helpers.
 */

import pkg from "../../package.json";

export const VERSION = pkg.version;

export const ENTRY_PATH = "src/index.ts";
export const MODULES_PATH = "src/modules";
export const MODULE_TESTS_PATH = "tests/modules";
export const BRIEF_PATH = ".loom/context/brief.md";
export const SKELETON_MD_PATH = ".loom/context/skeleton.md";
export const SKELETON_JSON_PATH = ".loom/context/skeleton.json";
export const MANIFEST_PATH = ".loom/manifest.json";
export const PACKAGE_PATH = "package.json";

export const LOOM_GENERATED_MARKER = "@loom-generated";
export const LOOM_GENERATED_HEADER = `// ${LOOM_GENERATED_MARKER}
// Update with Loom CLI commands.

`;

export const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
export const FORBIDDEN_PACKAGES = ["zod", "express"];

export const EXPECTED_PROTOCOL_COMMANDS = [
  "bun loom generate module <name>",
  "bun loom generate resource <name> --field <name:type>",
  "bun loom generate guard <name>",
  "bun loom generate middleware <name>",
  "bun loom generate hook <name>",
  "bun loom generate plugin <name>",
  "bun loom init swagger",
  "bun loom init env",
  "bun loom init auth",
  "bun loom init observability",
  "bun loom plan resource <name>",
  "bun loom validate resource <name>",
  "bun loom sync",
  "bun loom check",
  "bun loom routes",
  "bun loom info",
  "bun loom route <module> <method> <path>",
  "bun loom test <module>",
  "bun loom brief",
  "bun loom inspect <module>",
  "bun loom skeleton",
  "bun loom skeleton --json",
  "bun loom doctor",
  "bun loom doctor --strict"
];

export function moduleDir(slug: string) {
  return `${MODULES_PATH}/${slug}`;
}

export function moduleFiles(slug: string) {
  return {
    controller: `${MODULES_PATH}/${slug}/${slug}.controller.ts`,
    service: `${MODULES_PATH}/${slug}/${slug}.service.ts`,
    schema: `${MODULES_PATH}/${slug}/${slug}.schema.ts`
  };
}

export function moduleTestPath(slug: string) {
  return `${MODULE_TESTS_PATH}/${slug}.test.ts`;
}
