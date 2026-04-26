/**
 * LOOM CLI
 * Agent-centric module generator and skeleton mapper for Bun/Elysia.
 */

export { ANCHORS, createContext } from "./types";
export type { LoomContext, ModuleMeta } from "./types";
export { normalizeModuleName } from "./utils";
export {
  generateModule,
  generateResource,
  removeModule,
  addRoute,
  generateModuleTest,
  inspectModule
} from "./modules";
export {
  syncContext,
  refreshSkeleton,
  refreshBrief,
  createSkeleton
} from "./context";
export {
  runDoctor,
  runCheck,
  printRoutes,
  printInfo
} from "./doctor";
export { runLoom } from "./cli";

import { runLoom } from "./cli";

if (import.meta.main) {
  const code = await runLoom(Bun.argv.slice(2));
  process.exit(code);
}
