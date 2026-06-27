/** Subset of the Claude Code PreToolUse hook payload we read. */
export interface HookPayload {
  readonly tool_name?: string;
  readonly tool_input?: { readonly subagent_type?: string };
  /** Present only inside Task-spawned subagent contexts. */
  readonly agent_id?: string;
}

export interface RouteDecision {
  readonly deny: boolean;
  readonly message?: string;
}

/**
 * Decide whether a `Task` call should be blocked because it targets an agent that
 * is already running as a live pane. Pure so it can be unit-tested; the CLI entry
 * (`route-hook.ts`) just wires stdin/argv/exit codes around it.
 *
 * Fails open: anything not a `Task` against a live teammate is allowed, and nested
 * subagent contexts (which carry `agent_id`) are never interfered with.
 */
export function decideTaskRoute(payload: HookPayload, roster: readonly string[]): RouteDecision {
  if (payload.agent_id) return { deny: false };
  if (payload.tool_name !== 'Task') return { deny: false };
  const target = payload.tool_input?.subagent_type;
  if (!target || !roster.includes(target)) return { deny: false };
  return {
    deny: true,
    message:
      `Software Teams panes mode: '${target}' is ALREADY running as a live teammate pane — ` +
      `do not spawn it as a subagent. If you are the orchestrator, use ` +
      `team_delegate(to: "${target}", task: "...", ref: "T#"); otherwise ` +
      `team_send(to: "${target}", body: "..."). Then await its team_report.`,
  };
}
