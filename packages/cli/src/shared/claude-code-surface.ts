/**
 * Canonical Claude Code surface: the exact strings the harness accepts.
 *
 * Single source of truth for the frontmatter gate (`software-teams
 * validate-frontmatter`). Every list here is transcribed from the Claude Code
 * reference docs, not inferred. When Claude Code adds a tool or a model family,
 * update this file and nothing else.
 *
 * Node-safe (no Bun APIs) so the n8n package can consume it across the
 * workspace boundary.
 *
 * Why this exists: Software Teams shipped `Task`, `MultiEdit`, and four
 * generations of stale model IDs in agent and command frontmatter. None of it
 * failed a build, a lint, or a test - the harness silently ignores an unknown
 * tool name and an unknown settings key. The gate is the only thing that turns
 * that class of rot into a red build.
 */

/** Every built-in tool name Claude Code recognises. */
export const CLAUDE_CODE_TOOLS: readonly string[] = [
  "Agent",
  "Artifact",
  "AskUserQuestion",
  "Bash",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EndConversation",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "LSP",
  "ListAgents",
  "ListMcpResourcesTool",
  "Monitor",
  "NotebookEdit",
  "PowerShell",
  "PushNotification",
  "Read",
  "ReadMcpResourceTool",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "SendUserFile",
  "ShareOnboardingGuide",
  "Skill",
  // Injected into the session only when --json-schema is passed. Absent from
  // the public tools reference, but it is a real tool name and MUST be
  // grantable: see STRUCTURED_OUTPUT_TOOL below.
  "StructuredOutput",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "WaitForMcpServers",
  "WebFetch",
  "WebSearch",
  "Workflow",
  "Write",
];

/**
 * Tools the harness strips from every subagent, whatever the `tools` list says.
 *
 * Listing one in an agent spec is not an error the harness reports; it simply
 * has no effect, which is worse. `ExitPlanMode` survives only when the agent
 * sets `permissionMode: plan`, and `Agent` only until the nesting depth limit,
 * so both are listed as conditional rather than absolute.
 */
export const SUBAGENT_STRIPPED_TOOLS: readonly string[] = [
  "AskUserQuestion",
  "EndConversation",
  "EnterPlanMode",
  "ScheduleWakeup",
  "TaskOutput",
  "WaitForMcpServers",
  "Workflow",
];

/** Tool names Software Teams used to ship that no longer exist, with the fix. */
export const RETIRED_TOOL_REPLACEMENTS: Readonly<Record<string, string>> = {
  Task: "Agent",
  MultiEdit: "Edit",
};

/** Model aliases accepted by `--model`, subagent `model:`, and skill `model:`. */
export const MODEL_ALIASES: readonly string[] = [
  "default",
  "best",
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "opus[1m]",
  "sonnet[1m]",
  "opusplan",
  "inherit",
];

/** Effort levels accepted by subagent and skill `effort:` frontmatter. */
export const EFFORT_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** Subagent `memory` scopes. A value outside this set is ignored by the harness. */
export const MEMORY_SCOPES: readonly string[] = ["user", "project", "local"];

/**
 * Superseded model-ID prefixes, and the alias that replaces each.
 *
 * A stale pin like `claude-opus-4-6` is still well-formed, so a "starts with
 * claude-" check waves it through - which is exactly how Software Teams ended
 * up shipping four generations of dead IDs. Enumerating what is RETIRED is
 * tractable and stable; enumerating what is VALID is a treadmill.
 *
 * Prefixes are matched against the start of the value, so `claude-opus-4`
 * covers every 4.x Opus point release.
 */
export const RETIRED_MODEL_PREFIXES: Readonly<Record<string, string>> = {
  "claude-opus-3": "opus",
  "claude-opus-4": "opus",
  "claude-sonnet-3": "sonnet",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-3": "haiku",
  "claude-3": "haiku",
  "claude-2": "sonnet",
  "claude-instant": "haiku",
};

/** The replacement alias for a superseded model pin, or undefined if current. */
export function retiredModelReplacement(value: string): string | undefined {
  const hit = Object.keys(RETIRED_MODEL_PREFIXES).find((prefix) => value.startsWith(prefix));
  return hit ? RETIRED_MODEL_PREFIXES[hit] : undefined;
}

/**
 * True when `value` is a model the harness will accept.
 *
 * Full IDs are matched by prefix rather than enumerated: Claude Code itself
 * accepts "any name that starts with `claude-`" on the Anthropic API, and
 * pinning the enumeration here would put this file back on the treadmill the
 * gate exists to stop.
 */
export function isValidModel(value: string): boolean {
  return MODEL_ALIASES.includes(value) || value.startsWith("claude-");
}

/** True when `value` is a real Claude Code tool name (bare, no permission scope). */
export function isValidToolName(value: string): boolean {
  return CLAUDE_CODE_TOOLS.includes(value);
}

/**
 * The tool Claude Code uses to emit `--json-schema` structured output.
 *
 * Passing `--json-schema` injects this tool into the session, and the model
 * calls it to deliver the validated object. That makes it a hard dependency of
 * structured output, and a silent one: if an agent restricts its `tools` list
 * and omits this name, the tool is filtered out, the model has no way to emit
 * the object, and `structured_output` comes back `null` with no error, no
 * warning, and an otherwise successful run.
 *
 * Verified on 2.1.220: an agent with `tools: [Read, Grep]` yields
 * `structured_output: null`; the same agent with `tools: [Read, Grep,
 * StructuredOutput]` yields the object. Any caller that combines a restricted
 * tool list with `--json-schema` must append this.
 */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** Append the structured-output tool to a restricted list, without duplicating it. */
export function withStructuredOutput(tools: readonly string[]): string[] {
  return tools.includes(STRUCTURED_OUTPUT_TOOL)
    ? [...tools]
    : [...tools, STRUCTURED_OUTPUT_TOOL];
}

/**
 * Model choices offered by the n8n node dropdowns.
 *
 * Shared so the list cannot drift between nodes. Aliases lead because they
 * track the current version; the pinned IDs below them are for callers who
 * need a fixed one, including the interim releases, which is what you reach
 * for when a workflow has been tuned against one model's behaviour and should
 * not follow an alias forward.
 *
 * Every value here was checked against the CLI before being listed. An earlier
 * revision shipped an ID no model answered to, which fails only at run time.
 * Names are title case for the n8n node linter.
 */
export const N8N_MODEL_OPTIONS: ReadonlyArray<{ readonly name: string; readonly value: string }> = [
  { name: "Inherit Session Default", value: "" },
  { name: "Sonnet (Latest)", value: "sonnet" },
  { name: "Opus (Latest)", value: "opus" },
  { name: "Haiku (Latest)", value: "haiku" },
  { name: "Fable (Latest)", value: "fable" },
  { name: "Claude Opus 5", value: "claude-opus-5" },
  { name: "Claude Opus 4.8", value: "claude-opus-4-8" },
  { name: "Claude Opus 4.7", value: "claude-opus-4-7" },
  { name: "Claude Opus 4.6", value: "claude-opus-4-6" },
  { name: "Claude Sonnet 5", value: "claude-sonnet-5" },
  { name: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
  { name: "Claude Fable 5", value: "claude-fable-5" },
  { name: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
];

/**
 * The house response style, appended to every specialist prompt.
 *
 * Applied centrally by the two surfaces that build a system prompt - the
 * plugin renderer and the n8n agent-definition builder - rather than written
 * into each spec, so a new specialist inherits it and cannot drift.
 *
 * These are the ASD-STE100 WRITING rules. Full compliance also requires the
 * licensed approved-word dictionary, which no prompt can certify, so this
 * constrains grammar, sentence length, and consistency, and makes no claim to
 * dictionary conformance.
 *
 * The last paragraph matters most: STE governs prose. An agent that
 * "simplifies" an identifier, a command, or quoted log output has corrupted
 * the evidence it was asked to report.
 */
export const STE_RESPONSE_STYLE = `## Response language

Write all prose in Simplified Technical English (the ASD-STE100 writing rules).

- Give one instruction per sentence. Keep instructions to 20 words, descriptions to 25.
- Use the active voice, and name the actor.
- Use simple tenses. Prefer the present.
- Keep articles: write "the file", not "file".
- Use one term for one thing. Never vary a word for style.
- Prefer a verb to a noun made from a verb: "if the build fails", not "on build failure".
- Do not use an -ing form where a simple verb works.
- Do not use slang, idiom, metaphor, or humour.
- In a warning, state the condition first and the action second.
- Keep a paragraph to six sentences or fewer.

This governs prose only. Reproduce identifiers, code, commands, file paths, error
messages, and quoted output exactly as they are. Never simplify evidence.`;

/** Default model for n8n nodes: daily-driver capability, current version. */
export const N8N_DEFAULT_MODEL = "sonnet";

/**
 * Effort choices offered by the n8n node dropdowns.
 *
 * The empty default is deliberate and leads the list: Anthropic's guidance is
 * to stay on the model's default effort and reach for the dial only when you
 * have a reason. Names are title case for the n8n node linter.
 */
export const N8N_EFFORT_OPTIONS: ReadonlyArray<{ readonly name: string; readonly value: string }> =
  [
    { name: "Model Default", value: "" },
    { name: "Low", value: "low" },
    { name: "Medium", value: "medium" },
    { name: "High", value: "high" },
    { name: "Extra High", value: "xhigh" },
    { name: "Max", value: "max" },
  ];
