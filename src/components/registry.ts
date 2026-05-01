/**
 * Component registry.
 *
 * T4: populated from the 16 migrated TS component modules under
 * `src/components/{meta,execution,planning,quality}/`. Explicit imports
 * (no glob magic) keep the registry deterministic and tree-shakeable.
 *
 * @see docs/typescript-injection-design.md §"Component data model"
 */

import type { Component, ComponentCategory } from "./types";

// meta
import AgentBase from "./meta/AgentBase";
import AgentRouter from "./meta/AgentRouter";
import AgentTeamsOrchestration from "./meta/AgentTeamsOrchestration";
import ComplexityRouter from "./meta/ComplexityRouter";
import InteractiveGate from "./meta/InteractiveGate";
import SilentDiscovery from "./meta/SilentDiscovery";
import StateUpdate from "./meta/StateUpdate";
import StrictnessProtocol from "./meta/StrictnessProtocol";

// execution
import CodebaseContext from "./execution/CodebaseContext";
import Commit from "./execution/Commit";
import Verify from "./execution/Verify";
import VerifyAdvanced from "./execution/VerifyAdvanced";

// planning
import TaskBreakdown from "./planning/TaskBreakdown";
import WaveComputation from "./planning/WaveComputation";

// quality
import PRReview from "./quality/PRReview";

// hooks (Phase C — markdown sources retired)
import Checkpoint from "./hooks/Checkpoint";
import LintFixFrontend from "./hooks/LintFixFrontend";
import OnPause from "./hooks/OnPause";
import PreCommit from "./hooks/PreCommit";
import SoftwareTeamsWorktreeCleanup from "./hooks/SoftwareTeamsWorktreeCleanup";

// stacks (Phase C — markdown sources retired)
import PhpLaravel from "./stacks/PhpLaravel";
import ReactTypescript from "./stacks/ReactTypescript";

/**
 * The category directories that house component modules. `hooks` and
 * `stacks` were added in Phase C alongside the markdown→TS migration
 * for those subtrees.
 */
export const categories: readonly ComponentCategory[] = [
  "meta",
  "execution",
  "planning",
  "quality",
  "hooks",
  "stacks",
] as const;

/**
 * The live component registry, keyed by component `name`.
 * Frozen for immutability — components are immutable after registration.
 */
export const registry: Readonly<Record<string, Component>> = Object.freeze({
  [AgentBase.name]: AgentBase,
  [AgentRouter.name]: AgentRouter,
  [AgentTeamsOrchestration.name]: AgentTeamsOrchestration,
  [ComplexityRouter.name]: ComplexityRouter,
  [InteractiveGate.name]: InteractiveGate,
  [SilentDiscovery.name]: SilentDiscovery,
  [StateUpdate.name]: StateUpdate,
  [StrictnessProtocol.name]: StrictnessProtocol,
  [CodebaseContext.name]: CodebaseContext,
  [Commit.name]: Commit,
  [Verify.name]: Verify,
  [VerifyAdvanced.name]: VerifyAdvanced,
  [TaskBreakdown.name]: TaskBreakdown,
  [WaveComputation.name]: WaveComputation,
  [PRReview.name]: PRReview,
  [Checkpoint.name]: Checkpoint,
  [LintFixFrontend.name]: LintFixFrontend,
  [OnPause.name]: OnPause,
  [PreCommit.name]: PreCommit,
  [SoftwareTeamsWorktreeCleanup.name]: SoftwareTeamsWorktreeCleanup,
  [PhpLaravel.name]: PhpLaravel,
  [ReactTypescript.name]: ReactTypescript,
});

/**
 * Returns the list of registered component names in sorted order.
 * Used by CLI tooling (`software-teams component list`) and the validator.
 */
export function getRegistryKeys(): string[] {
  return Object.keys(registry).sort();
}
