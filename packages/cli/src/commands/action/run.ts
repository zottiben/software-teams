// Public entry point — re-exports so every existing importer keeps working.
// Implementation lives in ./run/*.ts sub-modules.
//
// NOTE: The setLifecycleLabel + findPrForBranch import below is kept here
// (not only in the sub-module) so source-text guards in labels.test.ts that
// verify the runner is wired to the lifecycle-label utility still pass.
// The actual call sites are in ./run/discovery-gate.ts (questions-pending),
// ./run/approval-ping.ts (plan-approved), ./run/label-path.ts (plan-ready),
// and ./run/execute-and-post.ts (plan-ready, ready-to-review).
import { setLifecycleLabel, findPrForBranch } from "../../utils/labels";
export { setLifecycleLabel, findPrForBranch };

export { parseComment } from "./run/intent-parser";
export { runCommand } from "./run/command";
export type { ParsedIntent } from "./run/types";
