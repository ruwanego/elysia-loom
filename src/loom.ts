/**
 * LOOM CLI
 * Agent-centric module generator and skeleton mapper for Bun/Elysia.
 */

export { ANCHORS, createContext } from "./lib/types";
export type { LoomContext, ModuleMeta } from "./lib/types";
export { normalizeModuleName } from "./lib/utils";
export {
  generateModule,
  generateResource,
  removeModule,
  addRoute,
  generateModuleTest,
  inspectModule
} from "./generators/modules";
export {
  generateCoreArtifact,
  removeCoreArtifact,
  initSwagger,
  listCoreArtifacts
} from "./generators/core";
export type { CoreArtifactKind } from "./generators/core-templates";
export {
  syncContext,
  refreshSkeleton,
  refreshBrief,
  createSkeleton
} from "./engine/context";
export {
  runDoctor,
  runCheck,
  printRoutes,
  printInfo
} from "./engine/doctor";
export { runLoom } from "./cli";

import { runLoom } from "./cli";

if (import.meta.main) {
  const code = await runLoom(Bun.argv.slice(2));
  process.exit(code);
}
