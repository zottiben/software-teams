import { consola } from "consola";

export interface SpawnClaudeOptions {
  cwd?: string;
  allowedTools?: string[];
  model?: string;
  permissionMode?: string;
}

const PROMPT_LENGTH_THRESHOLD = 100_000;

/**
 * Default allowed tools for spawned Claude sessions.
 *
 * This mirrors (and narrows) what `bypassPermissions` implicitly granted.
 * The declarative equivalent lives in `.claude/settings.json` at the project
 * root; callers that need different scope should pass their own list.
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
  "Bash(jdi:*)",
];

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

let lastEventType = "";

function formatStreamEvent(event: any): string | null {
  // Assistant text content
  if (event.type === "assistant" && event.message?.content) {
    const parts: string[] = [];
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        // Add a newline before text only if the previous event was a tool call
        const prefix = lastEventType === "tool" ? "\n" : "";
        parts.push(prefix + block.text.trim());
        lastEventType = "text";
      } else if (block.type === "tool_use") {
        const name = block.name ?? "tool";
        const input = block.input;
        let detail = "";
        if (input?.file_path) {
          // Shorten paths — show only last 3 segments
          const segments = input.file_path.split("/");
          detail = ` → ${segments.slice(-3).join("/")}`;
        } else if (name === "Bash" && input?.command) {
          detail = ` → ${input.command.slice(0, 60)}`;
        } else if (input?.pattern) {
          detail = ` → ${input.pattern}`;
        }
        parts.push(`  ⚡ ${name}${detail}`);
        lastEventType = "tool";
      }
    }
    if (parts.length > 0) return parts.join("\n") + "\n";
  }

  // Result event
  if (event.type === "result" && event.subtype === "error_tool_result") {
    lastEventType = "error";
    return "  ❌ Tool error\n";
  }

  return null;
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
    args.push(prompt);
  }

  consola.start("Launching Claude Code...\n");

  const proc = Bun.spawn(args, {
    cwd: opts?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    stdin: useStdin ? "pipe" : "ignore",
  });

  if (useStdin) {
    proc.stdin!.write(prompt);
    proc.stdin!.end();
  }

  // Stream and parse JSON events in real time, capturing final text response
  const reader = proc.stdout!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastTextResponse = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          const output = formatStreamEvent(event);
          if (output) process.stdout.write(output);

          // Capture the last assistant text as the final response
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                lastTextResponse = block.text;
              }
            }
          }
          // Also capture result text
          if (event.type === "result" && event.result) {
            lastTextResponse = event.result;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const output = formatStreamEvent(event);
        if (output) process.stdout.write(output);

        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              lastTextResponse = block.text;
            }
          }
        }
        if (event.type === "result" && event.result) {
          lastTextResponse = event.result;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // Stream ended
  }

  const exitCode = await proc.exited;
  process.stdout.write("\n");
  return { exitCode, response: lastTextResponse };
}
