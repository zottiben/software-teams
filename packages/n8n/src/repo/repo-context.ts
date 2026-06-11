/**
 * ADR-002 Decision D — canonical type for repo-scoped execution.
 * This is the SINGLE source of truth imported by T2, T7, T8, T9.
 * This type is OFF-WIRE: never serialised into NodeEnvelope or assemblePrompt.
 *
 * ChangeRef is the shared on-wire contract type; import it from @websitelabs/software-teams.
 */

import type { ChangeRef } from "@websitelabs/software-teams";

export type { ChangeRef };

/**
 * ADR-002 Decision D — the run's repository checkout descriptor.
 * Threaded as a typed optional parameter on `runAgentTurn(input, repoContext?)`.
 * Members are fixed and exhaustive; none may be added or removed without a new ADR.
 */
export interface RepoContext {
  readonly cloneUrl: string;
  readonly ownerRepo: string;
  readonly baseBranch: string;
  readonly correlationId: string;
  readonly worktreePath: string;
  readonly changeRef?: ChangeRef;
}
