/**
 * Inline single-turn execution adapter (Task disabled, structured I/O)
 *
 * Implements `runAgentTurn(input: NodeEnvelope): Promise<NodeEnvelope>` —
 * the reusable execution core every Agent and Orchestrator node calls.
 *
 * This module is compiled to CommonJS by n8n's tsconfig and runs under
 * Node.js inside the n8n worker. All Claude-CLI spawning is therefore done
 * with Node's `child_process` instead of Bun-specific APIs.
 *
 * Contract references:
 *   - n8n/CONTRACT.md §1  (NodeEnvelope shape)
 *   - n8n/CONTRACT.md §4  (upstream-context merge strategy)
 *   - n8n/CONTRACT.md §5  (needs-input marker convention)
 *   - ARCHITECTURE.md Decision B (single-turn, Task-disabled model)
 *   - spec AC2, AC3, AC9
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { NodeEnvelope } from "../contract/envelope";
// Security: input sanitisation primitives and the Task-disabled allowed-tools
// list are consumed from the communal CLI surface (single source of truth) via
// the @websitelabs/software-teams workspace dependency — no copy-paste here.
// sanitizeUserInput strips prompt-injection patterns and bounds length;
// fenceUserInput wraps untrusted content in XML tags with a model-facing warning.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedApi = require("@websitelabs/software-teams") as {
  sanitizeUserInput: (text: string, maxLength?: number) => string;
  fenceUserInput: (tag: string, content: string) => string;
  SINGLE_TURN_ALLOWED_TOOLS: readonly string[];
};

const { sanitizeUserInput, fenceUserInput, SINGLE_TURN_ALLOWED_TOOLS } = sharedApi;

export { SINGLE_TURN_ALLOWED_TOOLS };

// --------------------------------------------------------------------------
// Marker detection — CONTRACT.md §5
// --------------------------------------------------------------------------

/**
 * Regex that detects the in-band HITL marker the agent emits when it needs
 * a human decision. The question for the human follows the colon.
 */
const NEEDS_INPUT_RE = /^NEEDS_INPUT:\s*(.+)$/m;

// --------------------------------------------------------------------------
// Node-compatible Claude binary discovery
// --------------------------------------------------------------------------

/**
 * Locate the `claude` binary on PATH using Node's child_process.
 * Throws when not found.
 */
async function findClaude(): Promise<string> {
  const { execSync } = await import("child_process");
  try {
    const result = execSync("which claude", { encoding: "utf8" });
    const path = result.trim();
    if (path) return path;
  } catch {
    // not found via which
  }
  throw new Error(
    "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code " +
      "and ensure the binary is on PATH. " +
      "@websitelabs/n8n-nodes-software-teams requires a self-hosted n8n instance " +
      "with the `claude` binary and ANTHROPIC_API_KEY available on the worker.",
  );
}

// --------------------------------------------------------------------------
// Node-compatible Claude spawn
// --------------------------------------------------------------------------

const PROMPT_LENGTH_THRESHOLD = 100_000;

/**
 * Spawn `claude -p` with stream-json output and capture the last assistant
 * text response. Uses Node's `child_process.spawn` so it works inside n8n
 * workers which run on Node.js rather than Bun.
 */
async function spawnClaude(
  prompt: string,
  opts?: {
    allowedTools?: string[];
    cwd?: string;
    permissionMode?: string;
  },
): Promise<{ exitCode: number; response: string }> {
  const claudePath = await findClaude();
  const { spawn } = await import("child_process");

  const args: string[] = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--permission-mode",
    opts?.permissionMode ?? "acceptEdits",
  ];

  const allowedTools = opts?.allowedTools ?? [...SINGLE_TURN_ALLOWED_TOOLS];
  for (const tool of allowedTools) {
    args.push("--allowedTools", tool);
  }

  const useStdin = prompt.length >= PROMPT_LENGTH_THRESHOLD;
  if (!useStdin) {
    // `--` terminates option parsing so the prompt isn't swallowed by the
    // preceding variadic `--allowedTools` flag.
    args.push("--", prompt);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd: opts?.cwd ?? process.cwd(),
      stdio: useStdin ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
    });

    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    const streamState = { buffer: "", lastTextResponse: "" };

    const processLine = (trimmed: string) => {
      try {
        const event = JSON.parse(trimmed);
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              streamState.lastTextResponse = block.text;
            }
          }
        }
        if (event.type === "result" && event.result) {
          streamState.lastTextResponse = event.result;
        }
      } catch {
        // skip non-JSON lines
      }
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      streamState.buffer += chunk.toString("utf8");
      const lines = streamState.buffer.split("\n");
      streamState.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) processLine(trimmed);
      }
    });

    proc.on("close", (code) => {
      if (streamState.buffer.trim()) processLine(streamState.buffer.trim());
      resolve({ exitCode: code ?? 1, response: streamState.lastTextResponse });
    });

    proc.on("error", reject);
  });
}

// --------------------------------------------------------------------------
// Agent-spec resolution
// --------------------------------------------------------------------------

/**
 * Resolve the `.md` spec file for `agentId`.
 *
 * Resolution order (mirrors src/utils/prompt-builder.ts):
 *  1. `<root>/.claude/agents/<agentId>.md`  (synced, @ST: tags expanded)
 *  2. `<root>/agents/<agentId>.md`           (self-hosted source)
 *
 * `__dirname` at runtime is <root>/n8n/dist/src/execution; climb 4 levels
 * to reach the monorepo root (dist/src/execution → dist/src → dist → n8n → root).
 *
 * Returns `null` when no spec is found; callers degrade gracefully.
 */
function resolveAgentSpecPath(agentId: string): string | null {
  const pkgRoot = join(__dirname, "../../../..");
  const candidates = [
    join(pkgRoot, ".claude", "agents", `${agentId}.md`),
    join(pkgRoot, "agents", `${agentId}.md`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Strip YAML frontmatter from a spec file so only the prompt-relevant body
 * is inlined into the turn prompt.
 */
function stripSpecFrontmatter(content: string): string {
  const fm = content.match(/^---\n[\s\S]*?\n---\n?/);
  const rawBody = fm ? content.slice(fm[0].length) : content;
  return rawBody
    .replace(/^\s*<!--\s*AUTO-GENERATED[\s\S]*?-->\s*\n?/, "")
    .replace(/^\s*<!--\s*canonical frontmatter[\s\S]*?-->\s*\n?/, "")
    .trim();
}

// --------------------------------------------------------------------------
// Upstream-context merge — CONTRACT.md §4
// --------------------------------------------------------------------------

/**
 * Assemble the `claude -p` prompt string from the envelope's `input` per
 * CONTRACT.md §4 (chosen strategy: prepend a fenced JSON block).
 *
 * Security (T13 / R-01): `input.prompt` and `input.context` may contain
 * user-controlled data (e.g. Slack HITL answers, ticket text interpolated via
 * n8n expressions). We apply `sanitizeUserInput` to strip prompt-injection
 * patterns and truncate to a safe length, then wrap with `fenceUserInput` so
 * the model cannot be tricked by embedded instruction overrides.
 */
function assemblePrompt(input: NodeEnvelope["input"]): string {
  // Strip injection patterns and bound the prompt to 10 000 chars.
  const safePrompt = sanitizeUserInput(input.prompt, 10_000);
  // Wrap in an XML fence so the model knows this section is user-controlled.
  const fencedPrompt = fenceUserInput("user-task", safePrompt);

  const hasContext = isNonEmptyContext(input.context);

  if (!hasContext) {
    return `## Task\n${fencedPrompt}`;
  }

  const contextJson = JSON.stringify(input.context, null, 2);
  return `## Upstream context\n\`\`\`json\n${contextJson}\n\`\`\`\n\n## Task\n${fencedPrompt}`;
}

/** Ingestion boundary: context arrives from `NodeEnvelope.input.context` whose type is `unknown` on the wire; narrows here. */
function isNonEmptyContext(ctx: unknown): boolean {
  if (ctx === null || ctx === undefined) return false;
  if (typeof ctx === "object" && !Array.isArray(ctx)) {
    return Object.keys(ctx as Record<string, unknown>).length > 0;
  }
  return true;
}

// --------------------------------------------------------------------------
// Public adapter
// --------------------------------------------------------------------------

/**
 * Run exactly ONE specialist turn via the Claude CLI with the Task tool
 * disabled, and return a typed NodeEnvelope.
 */
export async function runAgentTurn(
  input: NodeEnvelope,
): Promise<NodeEnvelope> {
  // ── 1. Fail fast when the claude binary is unavailable (AC9, R-01) ──────
  try {
    await findClaude();
  } catch {
    return buildErrorEnvelope(
      input,
      "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code " +
        "and ensure the binary is on PATH. " +
        "@websitelabs/n8n-nodes-software-teams requires a self-hosted n8n instance " +
        "with the `claude` binary and ANTHROPIC_API_KEY available on the worker.",
    );
  }

  const specPath = resolveAgentSpecPath(input.agentId);
  const agentSpecBody = specPath
    ? (() => {
        try { return stripSpecFrontmatter(readFileSync(specPath, "utf8")); }
        catch { return ""; }
      })()
    : "";

  // ── 3. Assemble the full prompt ──────────────────────────────────────────
  const taskSection = assemblePrompt(input.input);
  const fullPrompt = agentSpecBody
    ? `${agentSpecBody}\n\n---\n\n${taskSection}`
    : taskSection;

  const spawnResult = await spawnClaude(fullPrompt, {
    allowedTools: [...SINGLE_TURN_ALLOWED_TOOLS],
  }).catch((err) => ({ _error: err instanceof Error ? err.message : String(err) }));

  if ("_error" in spawnResult) {
    return buildErrorEnvelope(input, `Failed to invoke claude CLI: ${spawnResult._error}`);
  }
  const { exitCode, response } = spawnResult;

  // ── 5. Detect needs-input marker (CONTRACT.md §5) ────────────────────────
  const needsInputMatch = NEEDS_INPUT_RE.exec(response);
  if (needsInputMatch) {
    return {
      correlationId: input.correlationId,
      agentId: input.agentId,
      status: "needs-input",
      input: input.input,
      result: { text: needsInputMatch[1]?.trim() ?? response },
      artifacts: input.artifacts,
    };
  }

  // ── 6. Map exit code → status ─────────────────────────────────────────────
  const status: NodeEnvelope["status"] = exitCode === 0 ? "ok" : "error";

  return {
    correlationId: input.correlationId,
    agentId: input.agentId,
    status,
    input: input.input,
    result: { text: response },
    artifacts: input.artifacts,
  };
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function buildErrorEnvelope(
  input: NodeEnvelope,
  message: string,
): NodeEnvelope {
  return {
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: "error",
    input: input.input,
    result: { text: message },
    artifacts: input.artifacts,
  };
}
