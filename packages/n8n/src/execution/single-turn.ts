import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { RepoContext } from "../repo/repo-context";
// Security (R-02 / T13): sanitizeUserInput strips prompt-injection patterns and
// bounds length; fenceUserInput wraps untrusted content in XML tags. Both are
// consumed from the shared CLI surface via the workspace dependency — no copy-paste.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedApi = require("@websitelabs/software-teams") as {
  sanitizeUserInput: (text: string, maxLength?: number) => string;
  fenceUserInput: (tag: string, content: string) => string;
  SINGLE_TURN_ALLOWED_TOOLS: readonly string[];
};

const { sanitizeUserInput, fenceUserInput, SINGLE_TURN_ALLOWED_TOOLS } = sharedApi;

export { SINGLE_TURN_ALLOWED_TOOLS };

const NEEDS_INPUT_RE = /^NEEDS_INPUT:\s*(.+)$/m;

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

const PROMPT_LENGTH_THRESHOLD = 100_000;

/**
 * Spawn `claude -p` with stream-json output and capture the last assistant
 * text response. Uses Node's child_process so it runs inside n8n workers (Node,
 * not Bun).
 */
async function spawnClaude(
  prompt: string,
  opts?: {
    allowedTools?: string[];
    cwd?: string;
    permissionMode?: string;
    githubToken?: string;
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
  args.push(...allowedTools.flatMap((tool) => ["--allowedTools", tool]));

  const useStdin = prompt.length >= PROMPT_LENGTH_THRESHOLD;
  if (!useStdin) {
    args.push("--", prompt);
  }

  const spawnEnv: NodeJS.ProcessEnv = opts?.githubToken
    ? { ...process.env, GITHUB_TOKEN: opts.githubToken }
    : { ...process.env };

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd: opts?.cwd ?? process.cwd(),
      env: spawnEnv,
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
          const textBlocks = (event.message.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text" && b.text);
          const last = textBlocks[textBlocks.length - 1];
          if (last?.text) streamState.lastTextResponse = last.text;
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
      lines
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach(processLine);
    });

    proc.on("close", (code) => {
      if (streamState.buffer.trim()) processLine(streamState.buffer.trim());
      resolve({ exitCode: code ?? 1, response: streamState.lastTextResponse });
    });

    proc.on("error", reject);
  });
}

function resolveAgentSpecPath(agentId: string): string | null {
  const candidates = [
    join(__dirname, "..", "..", "agents", `${agentId}.md`),
    join(__dirname, "..", "..", "..", "..", "..", ".claude", "agents", `${agentId}.md`),
    join(__dirname, "..", "..", "..", "..", "..", "agents", `${agentId}.md`),
  ];
  return candidates.find(existsSync) ?? null;
}

function stripSpecFrontmatter(content: string): string {
  const fm = content.match(/^---\n[\s\S]*?\n---\n?/);
  const rawBody = fm ? content.slice(fm[0].length) : content;
  return rawBody
    .replace(/^\s*<!--\s*AUTO-GENERATED[\s\S]*?-->\s*\n?/, "")
    .replace(/^\s*<!--\s*canonical frontmatter[\s\S]*?-->\s*\n?/, "")
    .trim();
}

/**
 * Assemble the `claude -p` prompt from the envelope's `input` per CONTRACT.md §4.
 * Security (T13 / R-01): `input.prompt` and `input.context` may contain
 * user-controlled data. `sanitizeUserInput` strips injection patterns and truncates;
 * `fenceUserInput` wraps with XML so the model cannot be tricked by overrides.
 */
function assemblePrompt(input: NodeEnvelope["input"]): string {
  const safePrompt = sanitizeUserInput(input.prompt, 10_000);
  const fencedPrompt = fenceUserInput("user-task", safePrompt);

  const hasContext = isNonEmptyContext(input.context);

  if (!hasContext) {
    return `## Task\n${fencedPrompt}`;
  }

  const contextJson = JSON.stringify(input.context, null, 2);
  return `## Upstream context\n\`\`\`json\n${contextJson}\n\`\`\`\n\n## Task\n${fencedPrompt}`;
}

/** Ingestion boundary: context arrives as `unknown` from NodeEnvelope.input.context on the wire; narrows here. */
function isNonEmptyContext(ctx: unknown): boolean {
  if (ctx === null || ctx === undefined) return false;
  if (typeof ctx === "object" && !Array.isArray(ctx)) {
    return Object.keys(ctx as Record<string, unknown>).length > 0;
  }
  return true;
}

export async function runAgentTurn(
  input: NodeEnvelope,
  repoContext?: RepoContext,
  githubToken?: string,
): Promise<NodeEnvelope> {
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

  const taskSection = assemblePrompt(input.input);
  const fullPrompt = agentSpecBody
    ? `${agentSpecBody}\n\n---\n\n${taskSection}`
    : taskSection;

  const spawnResult = await spawnClaude(fullPrompt, {
    allowedTools: [...SINGLE_TURN_ALLOWED_TOOLS],
    cwd: repoContext?.worktreePath,
    githubToken,
  }).catch((err) => ({ _error: err instanceof Error ? err.message : String(err) }));

  if ("_error" in spawnResult) {
    return buildErrorEnvelope(input, `Failed to invoke claude CLI: ${spawnResult._error}`);
  }
  const { exitCode, response } = spawnResult;

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
