/**
 * Communal allowed-tools constants shared across the package boundary.
 *
 * Node-safe (no Bun APIs) so the n8n community-node package can consume these
 * via the `@websitelabs/software-teams` workspace dependency. The CLI's
 * Bun-coupled `utils/claude.ts` re-exports them to preserve its public import
 * path; `n8n/src/execution/single-turn.ts` imports them from the package
 * surface. Single source of truth — no copy-paste across the boundary.
 */

/**
 * Default allowed tools for spawned Claude sessions.
 *
 * Mirrors (and narrows) what `bypassPermissions` implicitly granted. The
 * declarative equivalent lives in `.claude/settings.json` at the project root;
 * callers that need different scope should pass their own list.
 */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "Task",
  "Bash(bun:*)",
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(mkdir:*)",
  "Bash(rm:*)",
  "Bash(software-teams:*)",
];

/**
 * Allowed tools for single-turn n8n node execution (Task-disabled).
 *
 * Identical to DEFAULT_ALLOWED_TOOLS with `"Task"` omitted — enforces the AC2
 * constraint that each n8n Agent node runs exactly ONE specialist turn with no
 * internal sub-agent spawning. Agent-to-agent collaboration flows over the n8n
 * canvas (NodeEnvelope handoff) instead of Claude's Task tool.
 */
export const SINGLE_TURN_ALLOWED_TOOLS: readonly string[] =
  DEFAULT_ALLOWED_TOOLS.filter((tool) => tool !== "Task");
