import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { RepoContext } from "../repo/repo-context";
import { buildAgentDefinition } from "./agent-definition";
import { TURN_RESULT_SCHEMA, parseTurnResult, type TurnResult } from "./envelope-schema";

// Consumed from the shared CLI surface via the workspace dependency so there is
// exactly one definition of each. Security (R-02 / T13): sanitizeUserInput
// strips prompt-injection patterns and bounds length; fenceUserInput wraps
// untrusted content in XML tags.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedApi = require("@websitelabs/software-teams") as {
  sanitizeUserInput: (text: string, maxLength?: number) => string;
  fenceUserInput: (tag: string, content: string) => string;
  SINGLE_TURN_ALLOWED_TOOLS: readonly string[];
  SINGLE_TURN_DISALLOWED_TOOLS: readonly string[];
  buildAuthEnv: (
    config: { mode: string; oauthToken?: string; apiKey?: string },
    baseEnv: Readonly<Record<string, string | undefined>>,
  ) => Record<string, string | undefined>;
  assertAuthEnv: (mode: string, env: Readonly<Record<string, string | undefined>>) => void;
  classifyResult: (payload: ClaudeResultPayload | undefined, text: string) => TerminalState;
  isRetryableLater: (state: TerminalState) => boolean;
};

type TerminalState = "ok" | "needs-input" | "budget" | "turns" | "usage-limit" | "auth" | "error";

interface ClaudeResultPayload {
  subtype?: string;
  is_error?: boolean;
  result?: string | null;
  structured_output?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
  terminal_reason?: string;
  api_error_status?: number | null;
  modelUsage?: Record<string, unknown>;
}

const {
  sanitizeUserInput,
  fenceUserInput,
  SINGLE_TURN_ALLOWED_TOOLS,
  SINGLE_TURN_DISALLOWED_TOOLS,
  buildAuthEnv,
  assertAuthEnv,
  classifyResult,
  isRetryableLater,
} = sharedApi;

export { SINGLE_TURN_ALLOWED_TOOLS, SINGLE_TURN_DISALLOWED_TOOLS };

const PROMPT_LENGTH_THRESHOLD = 100_000;

/**
 * Legacy free-text signal that an agent needs a human decision.
 *
 * Structured output is the primary channel now. This stays as a FALLBACK for
 * the case where structured output could not be produced - a run cut short, or
 * a spec whose tool list omits the structured-output tool - so a clear request
 * for input is still routed to a human rather than reported as a finished turn.
 * It is never consulted when a structured result is present.
 */
const NEEDS_INPUT_RE = /^NEEDS_INPUT:\s*(.+)$/m;

/** How the spawned process authenticates. See shared/claude-auth.ts. */
export interface AuthOptions {
  mode: "subscription" | "apiKey";
  oauthToken?: string;
  apiKey?: string;
}

export interface AgentTurnOptions {
  /** Model alias (`opus`, `sonnet`, `haiku`, `fable`) or full ID. */
  model?: string;
  /** Effort level (`low` | `medium` | `high` | `xhigh` | `max`). Unset inherits the model default. */
  effort?: string;
  /** Hard ceiling on spend for this turn, in USD. Enforced between turns, so it can overshoot. */
  maxBudgetUsd?: number;
  /** Hard ceiling on agentic turns. */
  maxTurns?: number;
  /** Comma-separated fallback models tried when the primary is overloaded. */
  fallbackModel?: string;
  /** Resume this Claude Code session instead of starting a fresh one. */
  resumeSessionId?: string;
  /** Credential for the spawned process. Defaults to inheriting the worker's environment. */
  auth?: AuthOptions;
}

async function findClaude(): Promise<string> {
  const { execSync } = await import("child_process");
  try {
    const path = execSync("which claude", { encoding: "utf8" }).trim();
    if (path) return path;
  } catch {
    // not found via which
  }
  throw new Error(
    "Claude CLI not found. Install it with `curl -fsSL https://claude.ai/install.sh | bash` " +
      "and ensure the binary is on PATH. @websitelabs/n8n-nodes-software-teams requires a " +
      "self-hosted n8n instance with the `claude` binary on the worker and a credential " +
      "supplying either a subscription OAuth token or an Anthropic API key.",
  );
}

interface SpawnOutcome {
  exitCode: number;
  text: string;
  payload?: ClaudeResultPayload;
}

/**
 * Spawn `claude -p` and capture its final result object.
 *
 * Uses Node's child_process so it runs inside n8n workers (Node, not Bun).
 *
 * Notable choices:
 *  - `--agents` + `--agent` give the specialist a real system prompt, tool
 *    restrictions, model, and effort, rather than pasting its spec into the
 *    user turn.
 *  - `--json-schema` makes the agent state its own outcome instead of the node
 *    guessing from transcript text.
 *  - `--setting-sources ''` and `--strict-mcp-config` stop a worker's ambient
 *    project config from changing what a workflow does. `--bare` would be the
 *    blunter tool, but it cannot read the subscription OAuth token.
 *  - `--exclude-dynamic-system-prompt-sections` moves per-machine detail out of
 *    the system prompt so the prefix caches across executions and workers.
 */
async function spawnClaude(
  prompt: string,
  opts: {
    agentId?: string;
    agentsJson?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    model?: string;
    effort?: string;
    maxBudgetUsd?: number;
    maxTurns?: number;
    fallbackModel?: string;
    sessionId?: string;
    resumeSessionId?: string;
    jsonSchema?: string;
    cwd?: string;
    permissionMode?: string;
    githubToken?: string;
    auth?: AuthOptions;
  },
): Promise<SpawnOutcome> {
  const claudePath = await findClaude();
  const { spawn } = await import("child_process");

  const args: string[] = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    opts.permissionMode ?? "acceptEdits",
    // Deterministic across workers: ignore whatever user/project settings and
    // MCP servers happen to exist on the machine running this execution.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--exclude-dynamic-system-prompt-sections",
  ];

  if (opts.agentsJson && opts.agentId) {
    args.push("--agents", opts.agentsJson, "--agent", opts.agentId);
  }

  for (const tool of opts.allowedTools ?? SINGLE_TURN_ALLOWED_TOOLS) {
    args.push("--allowedTools", tool);
  }
  // `--allowedTools` only waives the permission prompt; removing a tool needs
  // `--disallowedTools`.
  for (const tool of opts.disallowedTools ?? SINGLE_TURN_DISALLOWED_TOOLS) {
    args.push("--disallowedTools", tool);
  }

  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.fallbackModel) args.push("--fallback-model", opts.fallbackModel);
  if (opts.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.jsonSchema) args.push("--json-schema", opts.jsonSchema);

  // Resuming continues the conversation a question was asked from; a fresh
  // session id makes the run addressable for a later resume.
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  else if (opts.sessionId) args.push("--session-id", opts.sessionId);

  const useStdin = prompt.length >= PROMPT_LENGTH_THRESHOLD;
  if (!useStdin) args.push("--", prompt);

  // Build the child environment explicitly. Never mutate process.env: an n8n
  // worker is long-lived and shared, so a mutation leaks into later executions.
  const spawnEnv = opts.auth
    ? buildAuthEnv(opts.auth, process.env)
    : ({ ...process.env } as Record<string, string | undefined>);
  if (opts.auth) assertAuthEnv(opts.auth.mode, spawnEnv);
  if (opts.githubToken) spawnEnv["GITHUB_TOKEN"] = opts.githubToken;

  return new Promise<SpawnOutcome>((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: spawnEnv,
      stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    const chunks = { out: "", err: "" };
    proc.stdout?.on("data", (c: Buffer) => (chunks.out += c.toString("utf8")));
    proc.stderr?.on("data", (c: Buffer) => (chunks.err += c.toString("utf8")));

    proc.on("close", (code, signal) => {
      const payload = extractResultPayload(chunks.out);
      // A failure often reports itself only on stderr or as bare stdout text
      // (auth errors, for one), so both feed the classifier.
      const text = payload?.result ?? `${chunks.out}\n${chunks.err}`.trim();
      // SIGTERM from a process supervisor exits 143; surface it rather than
      // reporting an empty success.
      const exitCode = code ?? (signal ? 143 : 1);
      resolve({ exitCode, text, payload });
    });

    proc.on("error", reject);
  });
}

/**
 * Pull the result object out of `--output-format json` stdout.
 *
 * Claude Code prints warnings ahead of the JSON in some configurations - an
 * untrusted workspace, for instance - so the payload is located rather than
 * assumed to start at byte zero.
 */
export function extractResultPayload(stdout: string): ClaudeResultPayload | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;

  const start = trimmed.indexOf("{");
  if (start === -1) return undefined;

  try {
    return JSON.parse(trimmed.slice(start)) as ClaudeResultPayload;
  } catch {
    // Fall back to the last complete JSON line.
    const lines = trimmed.split("\n").reverse();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        return JSON.parse(l) as ClaudeResultPayload;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

/**
 * Assemble the `claude -p` prompt from the envelope's `input`.
 *
 * The agent's identity now travels in `--agents`, so this carries only the
 * turn's task and upstream context.
 *
 * Security (T13 / R-01): `input.prompt` and `input.context` may contain
 * user-controlled data. `sanitizeUserInput` strips injection patterns and
 * truncates; `fenceUserInput` wraps with XML so the model cannot be tricked by
 * overrides.
 */
function assemblePrompt(input: NodeEnvelope["input"]): string {
  const fencedPrompt = fenceUserInput("user-task", sanitizeUserInput(input.prompt, 10_000));
  if (!isNonEmptyContext(input.context)) return `## Task\n${fencedPrompt}`;

  const contextJson = JSON.stringify(input.context, null, 2);
  return `## Upstream context\n\`\`\`json\n${contextJson}\n\`\`\`\n\n## Task\n${fencedPrompt}`;
}

/** Ingestion boundary: context arrives as `unknown` from NodeEnvelope.input.context. */
function isNonEmptyContext(ctx: unknown): boolean {
  if (ctx === null || ctx === undefined) return false;
  if (typeof ctx === "object" && !Array.isArray(ctx)) {
    return Object.keys(ctx as Record<string, unknown>).length > 0;
  }
  return true;
}

/**
 * Derive a stable session UUID from a correlationId.
 *
 * `--session-id` requires a UUID. Deriving one deterministically means a later
 * turn can resume the conversation knowing only the correlationId, without the
 * workflow having to carry a second identifier.
 */
export function sessionIdFor(correlationId: string): string | undefined {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRe.test(correlationId) ? correlationId : undefined;
}

function usageFrom(payload: ClaudeResultPayload | undefined): NodeEnvelope["usage"] {
  if (!payload) return undefined;
  return {
    costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : 0,
    turns: typeof payload.num_turns === "number" ? payload.num_turns : 0,
    models: Object.keys(payload.modelUsage ?? {}),
    ...(payload.terminal_reason ? { terminalReason: payload.terminal_reason } : {}),
  };
}

/** Map a classified terminal state onto the envelope's status union. */
function statusFor(state: TerminalState, turn: TurnResult | null): NodeEnvelope["status"] {
  if (isRetryableLater(state)) return "retry-later";
  if (state === "ok") return turn?.status === "needs-input" ? "needs-input" : (turn?.status ?? "ok");
  if (state === "needs-input") return "needs-input";
  return "error";
}

export async function runAgentTurn(
  input: NodeEnvelope,
  repoContext?: RepoContext,
  githubToken?: string,
  options?: AgentTurnOptions,
): Promise<NodeEnvelope> {
  try {
    await findClaude();
  } catch (err) {
    return buildErrorEnvelope(input, err instanceof Error ? err.message : String(err));
  }

  const baseDir = repoContext?.worktreePath ?? process.cwd();
  const definition = buildAgentDefinition({
    agentId: input.agentId,
    baseDir,
    structuredOutput: true,
    overrides: { model: options?.model, effort: options?.effort },
  });

  const spawnResult = await spawnClaude(assemblePrompt(input.input), {
    agentId: definition ? input.agentId : undefined,
    agentsJson: definition ? JSON.stringify({ [input.agentId]: definition }) : undefined,
    model: options?.model,
    effort: options?.effort,
    maxBudgetUsd: options?.maxBudgetUsd,
    maxTurns: options?.maxTurns,
    fallbackModel: options?.fallbackModel,
    sessionId: sessionIdFor(input.correlationId),
    resumeSessionId: options?.resumeSessionId,
    jsonSchema: JSON.stringify(TURN_RESULT_SCHEMA),
    cwd: repoContext?.worktreePath,
    githubToken,
    auth: options?.auth,
  }).catch((err: unknown) => ({
    _error: err instanceof Error ? err.message : String(err),
  }));

  if ("_error" in spawnResult) {
    return buildErrorEnvelope(input, `Failed to invoke claude CLI: ${spawnResult._error}`);
  }

  const { text, payload } = spawnResult;
  const state = classifyResult(payload, text);
  const turn = parseTurnResult(payload?.structured_output);

  // Fallback only: honoured when structured output is absent, so a clear
  // request for input is not reported as a finished turn.
  const legacyNeedsInput = turn ? null : (NEEDS_INPUT_RE.exec(text)?.[1]?.trim() ?? null);

  const resultText = ((): string => {
    if (turn) {
      return turn.status === "needs-input" && turn.question ? turn.question : turn.summary;
    }
    return legacyNeedsInput ?? text;
  })();

  const envelope: NodeEnvelope = {
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: legacyNeedsInput && state === "ok" ? "needs-input" : statusFor(state, turn),
    input: input.input,
    result: {
      text: resultText,
      ...(turn?.filesChanged ? { filesChanged: turn.filesChanged } : {}),
      ...(turn?.confidence !== undefined ? { confidence: turn.confidence } : {}),
    },
    artifacts: input.artifacts,
  };

  const usage = usageFrom(payload);
  if (usage) envelope.usage = usage;
  if (payload?.session_id) envelope.sessionId = payload.session_id;

  return envelope;
}

function buildErrorEnvelope(input: NodeEnvelope, message: string): NodeEnvelope {
  return {
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: "error",
    input: input.input,
    result: { text: message },
    artifacts: input.artifacts,
  };
}
