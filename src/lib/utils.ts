/**
 * LOOM UTILITIES
 * String helpers and name normalization.
 */

import type { ModuleMeta } from "./types";
import { LoomError } from "./types";

export function normalizeModuleName(input: string): ModuleMeta {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new LoomError("Error: module name must contain at least one letter or number.");
  }

  const rawPascalName = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  const pascalName = /^[A-Za-z_$]/.test(rawPascalName)
    ? rawPascalName
    : `Module${rawPascalName}`;

  return {
    slug,
    pascalName,
    controllerName: `${pascalName.charAt(0).toLowerCase()}${pascalName.slice(1)}Controller`
  };
}

export function camelName(name: string) {
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

export function titleName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function escapeTsString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSlash(path: string) {
  return path.replace(/\\/g, "/");
}

export function trimLiteralQuotes(value: string) {
  return value.replace(/^"|"$/g, "");
}

export function pascalFromPath(routePath: string) {
  const normalized = routePath
    .replace(/:[A-Za-z0-9_-]+/g, (segment) => segment.slice(1))
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return "Root";
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function fullRoutePath(prefix: string, path: string) {
  if (path === "/") {
    return prefix;
  }

  return `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
