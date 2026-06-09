import { consola } from "consola";

export {
  DEFAULT_ALLOWED_TOOLS,
  SINGLE_TURN_ALLOWED_TOOLS,
} from "../shared/agent-tools";
import { DEFAULT_ALLOWED_TOOLS } from "../shared/agent-tools";

export interface SpawnClaudeOptions {
  cwd?: string;
  allowedTools?: string[];
  model?: string;
  permissionMode?: string;
}

const PROMPT_LENGTH_THRESHOLD = 100_000;

export async function findClaude(): Promise<string> {
  const path = Bun.which("claude");
  if (path) return path;

  // Fallback: check common install locations
  const { exec } = await import("./git");
  const { stdout, exitCode } = await exec(["which", "claude"]);
  if (exitCode === 0 && stdout) return stdout;

  throw new Error(
    "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code",
  );
}

/** Stream event shapes emitted by `claude --output-format stream-json`. */
interface ClaudeStreamBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { file_path?: string; command?: string; pattern?: string };
}
interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: { content?: ClaudeStreamBlock[] };
  result?: string;
}

function makeStreamFormatter() {
  const state = { lastEventType: "" };

  return function formatStreamEvent(event: ClaudeStreamEvent): string | null {
    if (event.type === "assistant" && event.message?.content) {
      const parts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          const prefix = state.lastEventType === "tool" ? "\n" : "";
          parts.push(prefix + block.text.trim());
          state.lastEventType = "text";
        } else if (block.type === "tool_use") {
          const name = block.name ?? "tool";
          const input = block.input;
          const detail = input?.file_path
            ? ` → ${(input.file_path as string).split("/").slice(-3).join("/")}`
            : name === "Bash" && input?.command
              ? ` → ${(input.command as string).slice(0, 60)}`
              : input?.pattern
                ? ` → ${input.pattern}`
                : "";
          parts.push(`  ⚡ ${name}${detail}`);
          state.lastEventType = "tool";
        }
      }
      if (parts.length > 0) return parts.join("\n") + "\n";
    }

    if (event.type === "result" && event.subtype === "error_tool_result") {
      state.lastEventType = "error";
      return "  ❌ Tool error\n";
    }

    return null;
  };
}

export async function spawnClaude(
  prompt: string,
  opts?: SpawnClaudeOptions,
): Promise<{ exitCode: number; response: string }> {
  const claudePath = await findClaude();
  const args = [
    claudePath,
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--permission-mode", opts?.permissionMode ?? "acceptEdits",
  ];

  const allowedTools = opts?.allowedTools ?? [...DEFAULT_ALLOWED_TOOLS];
  for (const tool of allowedTools) {
    args.push("--allowedTools", tool);
  }
  if (opts?.model) {
    args.push("--model", opts.model);
  }

  const useStdin = prompt.length >= PROMPT_LENGTH_THRESHOLD;

  if (!useStdin) {
    // `--` terminates option parsing so the prompt isn't swallowed by the
    // preceding variadic `--allowedTools` flag.
    args.push("--", prompt);
  }

  consola.start("Launching Claude Code...\n");

  const proc = Bun.spawn(args, {
    cwd: opts?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    stdin: useStdin ? "pipe" : "ignore",
  });

  if (useStdin) {
    if (!proc.stdin) throw new Error("Expected proc.stdin to be writable (stdin: \"pipe\")");
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  if (!proc.stdout) throw new Error("Expected proc.stdout to be readable (stdout: \"pipe\")");
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const formatStreamEvent = makeStreamFormatter();
  const streamState = { buffer: "", lastTextResponse: "" };

  const processChunk = (raw: string) => {
    try {
      const event = JSON.parse(raw);
      const output = formatStreamEvent(event);
      if (output) process.stdout.write(output);
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamState.buffer += decoder.decode(value, { stream: true });
      const lines = streamState.buffer.split("\n");
      streamState.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) processChunk(trimmed);
      }
    }

    if (streamState.buffer.trim()) processChunk(streamState.buffer.trim());
  } catch {
    // Stream ended
  }

  const exitCode = await proc.exited;
  process.stdout.write("\n");
  return { exitCode, response: streamState.lastTextResponse };
}
