// Fail-closed allow-list for --event-type values. New event types require an
// explicit code change — unknown values are rejected before any API calls.
export const ALLOWED_EVENT_TYPES = new Set(["issue_labeled"]);

/**
 * Model used for every parent-Claude spawn in the GitHub Action flow.
 *
 * Defaults to Sonnet — Opus was costing ~$1 per test on small changes when
 * the parent inherited Claude Code's account default. Sonnet 4.6 is more
 * than capable of the planner/implementer self-play this action does today.
 *
 * Override per-repo by setting the `SOFTWARE_TEAMS_MODEL` env var (wired
 * through `vars.SOFTWARE_TEAMS_MODEL` in the workflow). Accepts either an
 * alias (`sonnet`, `opus`, `haiku`) or a full model ID
 * (e.g. `claude-opus-4-7`).
 *
 * NOTE: this knob is parent-Claude only. Sub-agents spawned via the Task
 * tool still use the `model:` pin in their spec frontmatter. Once we
 * migrate the action from "self-play with injected spec" to "router that
 * delegates to native subagents," the planner's `model: opus` pin in
 * `agents/software-teams-planner.md` becomes the dominant cost lever and
 * should be revisited.
 */
export const ACTION_MODEL = process.env.SOFTWARE_TEAMS_MODEL || "claude-sonnet-4-6";
