/**
 * LOOM CLI
 * Argument parsing, command dispatch, and help output.
 */

import { VERSION } from "./lib/constants";
import { generateCoreArtifact, initAuth, initEnv, initObservability, initSwagger, removeCoreArtifact } from "./generators/core";
import type { CoreArtifactKind } from "./generators/core-templates";
import { syncContext } from "./engine/context";
import { refreshBrief, refreshSkeleton } from "./engine/context";
import { printInfo, printRoutes, runCheck, runDoctor } from "./engine/doctor";
import { runChildCommand } from "./lib/fs";
import {
  addRoute,
  generateModule,
  generateModuleTest,
  inspectModule,
  removeModule
} from "./generators/modules";
import { generateResource } from "./generators/modules";
import { createResourceSpec } from "./generators/resource";
import { normalizeModuleName } from "./lib/utils";
import type { LoomContext, ModuleMeta, ParsedArgs } from "./lib/types";
import { LoomError, createContext } from "./lib/types";

const CORE_ARTIFACT_KINDS = new Set<string>(["guard", "middleware", "hook", "plugin"]);

export async function runLoom(argv: string[], options: Partial<LoomContext> = {}) {
  const baseCtx = createContext(options);

  if (argv.includes("--version")) {
    baseCtx.log(VERSION);
    return 0;
  }

  try {
    const parsed = parseArgs(argv);
    const ctx = createContext({
      ...options,
      dryRun: Boolean(options.dryRun) || parsed.dryRun,
      emitJson: Boolean(options.emitJson) || parsed.emitJson
    });

    switch (parsed.command) {
      case "init":
        await runInitCommand(parsed, ctx);
        return 0;

      case "generate":
        await runGenerateCommand(parsed, ctx);
        return 0;

      case "remove":
        await runRemoveCommand(parsed, ctx);
        return 0;

      case "route":
        await addRoute(parsed.args[0], parsed.args[1], parsed.args[2], ctx);
        return 0;

      case "test":
        await requireModuleName(parsed.args[0], (meta) => generateModuleTest(meta, ctx));
        return 0;

      case "plan":
        await runPlanCommand(parsed, ctx);
        return 0;

      case "validate":
        return await runValidateCommand(parsed, ctx);

      case "sync":
        await syncContext(ctx);
        return 0;

      case "check":
        return await runCheck(ctx);

      case "routes":
        await printRoutes(ctx);
        return 0;

      case "info":
        await printInfo(ctx);
        return 0;

      case "dev":
        return await runChildCommand(ctx, ["bun", "run", "dev"]);

      case "brief":
        await refreshBrief(ctx);
        return 0;

      case "inspect":
        await requireModuleName(parsed.args[0], (meta) => inspectModule(meta, ctx));
        return 0;

      case "skeleton":
        await refreshSkeleton(ctx);
        return 0;

      case "doctor":
        return await runDoctor(ctx, parsed.strict);

      case "help":
      case undefined:
      default:
        printHelp(ctx);
        return ["help", undefined].includes(parsed.command) ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof LoomError) {
      baseCtx.error(error.message);
      return 1;
    }

    throw error;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const dryRunFlags = new Set(["--dry-run"]);
  const jsonFlags = new Set(["--json"]);
  const strictFlags = new Set(["--strict"]);
  const fieldFlags = new Set(["--field"]);
  const positional: string[] = [];
  const fields: string[] = [];
  let dryRun = false;
  let emitJson = false;
  let strict = false;
  let from: string | undefined;
  let route: string | undefined;
  let plural: string | undefined;
  let test = false;
  let noTest = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (dryRunFlags.has(arg)) {
      dryRun = true;
      continue;
    }

    if (jsonFlags.has(arg)) {
      emitJson = true;
      continue;
    }

    if (strictFlags.has(arg)) {
      strict = true;
      continue;
    }

    if (fieldFlags.has(arg)) {
      fields.push(readFlagValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--route") {
      route = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--from") {
      from = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--plural") {
      plural = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--test") {
      test = true;
      continue;
    }

    if (arg === "--no-test") {
      noTest = true;
      continue;
    }

    positional.push(arg);
  }

  return {
    command: positional[0] ?? "help",
    args: positional.slice(1),
    dryRun,
    emitJson,
    strict,
    fields,
    from,
    route,
    plural,
    test,
    noTest
  };
}

function readFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("-")) {
    throw new LoomError(`Missing value for ${flag}.`);
  }

  return value;
}

function printHelp(ctx: LoomContext) {
  ctx.log(`
LOOM CLI v${VERSION}
Usage: bun loom <command> [args]

Commands:
  init swagger              Wire @elysiajs/swagger into src/index.ts
  init env                  Add validated env plugin preset
  init auth                 Add auth plugin + auth guard preset
  init observability        Add logger/observability plugin preset
  generate module <name>    Create a CSS module and auto-register it
  generate resource <name>  Create typed CRUD resource from --field flags
  generate guard <name>     Create an Elysia guard (derive/resolve plugin)
  generate middleware <n>   Create an Elysia lifecycle middleware plugin
  generate hook <name>      Create an Elysia macro hook plugin
  generate plugin <name>    Create a generic Elysia plugin
  remove <name>             Remove a generated module or core artifact
  route <mod> <method> <p>  Add a service-backed route to a module
  test <module>             Generate Bun tests for a CSS module
  sync                      Refresh brief, skeleton.md, and skeleton.json
  check                     Run strict doctor and bun test
  plan <kind> <name>        Preview generated files without writing
  validate [kind] [name]    Validate project or resource specs
  routes                    Print registered module routes
  info                      Print Loom project summary
  dev                       Run bun run dev
  brief                     Refresh the ultra-small agent context
  inspect <module>          Print one module's compact context
  skeleton                  Refresh the Markdown context map
  doctor                    Audit Loom drift and registration health
  help                      Show this menu

Flags:
  --version                 Print Loom CLI version
  --dry-run                 Print planned writes without changing files
  --json                    Write both skeleton.md and skeleton.json
  --field <spec>            Resource field: name:type:required:min=1
  --from <path>             Read resource spec JSON
  --route <path>            Resource route prefix override
  --strict                  Enforce TDD and state-management gates in doctor
  --no-test                 Skip test generation for generated artifacts
`);
}

async function runInitCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [target] = parsed.args;

  switch (target) {
    case "swagger":
      await initSwagger(ctx);
      return;

    case "env":
      await initEnv(ctx);
      return;

    case "auth":
      await initAuth(ctx);
      return;

    case "observability":
      await initObservability(ctx);
      return;

    case undefined:
      throw new LoomError("Usage: bun loom init <swagger|env|auth|observability>");

    default:
      throw new LoomError(`Unsupported init target [${target}].`);
  }
}

async function runGenerateCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;

  if (kind && CORE_ARTIFACT_KINDS.has(kind)) {
    await requireModuleName(name, (meta) =>
      generateCoreArtifact(kind as CoreArtifactKind, meta, !parsed.noTest, ctx)
    );
    return;
  }

  switch (kind) {
    case "module":
      await requireModuleName(name, (meta) => generateModule(meta, ctx));
      return;

    case "resource":
      await requireModuleName(name, (meta) => generateResource(meta, {
        fields: parsed.fields,
        route: parsed.route,
        plural: parsed.plural,
        from: parsed.from,
        generateTest: !parsed.noTest
      }, ctx));
      return;

    case undefined:
      throw new LoomError("Usage: bun loom generate <module|resource|guard|middleware|hook|plugin> <name>");

    default:
      throw new LoomError(`Unsupported generate target [${kind}].`);
  }
}

async function runRemoveCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kindOrName, name] = parsed.args;

  if (kindOrName && CORE_ARTIFACT_KINDS.has(kindOrName) && name) {
    await requireModuleName(name, (meta) =>
      removeCoreArtifact(kindOrName as CoreArtifactKind, meta, ctx)
    );
    return;
  }

  await requireModuleName(kindOrName, (meta) => removeModule(meta, ctx));
}

async function runPlanCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;
  const planCtx = { ...ctx, dryRun: true };

  if (kind && CORE_ARTIFACT_KINDS.has(kind)) {
    await requireModuleName(name, (meta) =>
      generateCoreArtifact(kind as CoreArtifactKind, meta, !parsed.noTest, planCtx)
    );
    return;
  }

  switch (kind) {
    case "module":
      await requireModuleName(name, (meta) => generateModule(meta, planCtx));
      return;

    case "resource":
      await requireModuleName(name, (meta) => generateResource(meta, {
        fields: parsed.fields,
        route: parsed.route,
        plural: parsed.plural,
        from: parsed.from,
        generateTest: !parsed.noTest
      }, planCtx));
      return;

    case undefined:
      throw new LoomError("Usage: bun loom plan <module|resource|guard|middleware|hook|plugin> <name>");

    default:
      throw new LoomError(`Unsupported plan target [${kind}].`);
  }
}

async function runValidateCommand(parsed: ParsedArgs, ctx: LoomContext) {
  const [kind, name] = parsed.args;

  if (!kind) {
    return await runDoctor(ctx, false);
  }

  if (kind !== "resource") {
    throw new LoomError(`Unsupported validate target [${kind}].`);
  }

  await requireModuleName(name, async (meta) => {
    const spec = await createResourceSpec(meta, {
      fields: parsed.fields,
      route: parsed.route,
      plural: parsed.plural,
      from: parsed.from,
      generateTest: !parsed.noTest
    }, ctx);

    ctx.log(`Resource spec valid: ${spec.meta.slug}`);
    ctx.log(`Route: ${spec.routePrefix}`);
    ctx.log(`Fields: ${spec.fields.map((field) => field.name).join(", ")}`);
  });

  return 0;
}

async function requireModuleName(
  name: string | undefined,
  action: (meta: ModuleMeta) => Promise<void>
) {
  if (!name) {
    throw new LoomError("Error: module name required.");
  }

  await action(normalizeModuleName(name));
}
