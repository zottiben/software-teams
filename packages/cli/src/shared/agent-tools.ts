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
 * Default auto-approved tools for spawned Claude sessions.
 *
 * Passed as `--allowedTools`, which suppresses the permission prompt for these
 * tools. It does NOT restrict the tool pool: anything omitted here is still
 * callable, subject to the session's permission settings. Use `--tools` to
 * restrict, or `--disallowedTools` to remove.
 *
 * The declarative equivalent lives in `.claude/settings.json` under
 * `permissions.allow`; callers that need different scope pass their own list.
 *
 * Tool names must match Claude Code's canonical names exactly. `MultiEdit` and
 * `Task` were removed here because neither exists any more: `MultiEdit` was
 * folded into `Edit`, and the subagent-spawning tool is named `Agent`.
 */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Agent",
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
 * Auto-approved tools for single-turn n8n node execution.
 *
 * `Agent` is dropped so nested spawning is never silently auto-approved, but
 * omission alone does not prevent it — `--allowedTools` only waives the prompt.
 * SINGLE_TURN_DISALLOWED_TOOLS is what actually enforces the constraint.
 */
export const SINGLE_TURN_ALLOWED_TOOLS: readonly string[] =
  DEFAULT_ALLOWED_TOOLS.filter((tool) => tool !== "Agent");

/**
 * Tools removed from the pool for single-turn n8n node execution.
 *
 * Enforces the AC2 constraint that each n8n Agent node runs exactly ONE
 * specialist turn with no internal sub-agent spawning. Agent-to-agent
 * collaboration flows over the n8n canvas (NodeEnvelope handoff) instead.
 * Passed as `--disallowedTools`, which removes the tool rather than merely
 * declining to pre-approve it.
 */
export const SINGLE_TURN_DISALLOWED_TOOLS: readonly string[] = ["Agent"];
