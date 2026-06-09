import type { NodeEnvelope } from "../../../n8n/src/contract/envelope";
import { consola, createConsola } from "consola";

export const stderrLog = createConsola({
  stdout: process.stderr,
  stderr: process.stderr,
});

export function redirectConsolaToStderr(): void {
  (consola as unknown as { options: { stdout: NodeJS.WritableStream } }).options.stdout =
    process.stderr;
}

function isNodeEnvelope(obj: unknown): obj is NodeEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const e = obj as Record<string, unknown>;
  if (typeof e.correlationId !== "string" || e.correlationId.length === 0) return false;
  if (typeof e.agentId !== "string") return false;
  if (!["ok", "error", "needs-input"].includes(e.status as string)) return false;
  if (typeof e.input !== "object" || e.input === null) return false;
  if (typeof (e.input as Record<string, unknown>).prompt !== "string") return false;
  if (typeof e.result !== "object" || e.result === null) return false;
  if (typeof (e.result as Record<string, unknown>).text !== "string") return false;
  if (!Array.isArray(e.artifacts)) return false;
  return true;
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch { return { ok: false }; }
}

export type InputResult = { envelope: NodeEnvelope } | { error: string };

export interface ReadInputOptions {
  readStdin?: () => Promise<string>;
}

export async function readInputEnvelope(
  args: { envelope?: string },
  options?: ReadInputOptions,
): Promise<InputResult> {
  const readStdin = options?.readStdin ?? (() => Bun.stdin.text());

  if (args.envelope !== undefined) {
    const parseResult = tryParseJson(args.envelope);
    if (!parseResult.ok) return { error: "--envelope value is not valid JSON" };
    if (!isNodeEnvelope(parseResult.value)) {
      return { error: "--envelope value does not satisfy NodeEnvelope invariants" };
    }
    return { envelope: parseResult.value };
  }

  if (process.stdin.isTTY) {
    return {
      error:
        "No input envelope: stdin is a TTY and --envelope was not supplied",
    };
  }

  const stdinResult = await readStdin().then((t) => ({ ok: true as const, text: t.trim() })).catch(() => ({ ok: false as const }));
  if (!stdinResult.ok) return { error: "Failed to read stdin" };
  const stdinText = stdinResult.text;
  if (stdinText.length === 0) {
    return { error: "No input envelope: stdin was empty and --envelope was not supplied" };
  }

  const parseResult = tryParseJson(stdinText);
  if (!parseResult.ok) return { error: "stdin content is not valid JSON" };
  if (!isNodeEnvelope(parseResult.value)) {
    return { error: "stdin content does not satisfy NodeEnvelope invariants" };
  }

  return { envelope: parseResult.value };
}

export function writeResult(env: NodeEnvelope, opts: { json: boolean }): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(env) + "\n");
    return;
  }

  const preview =
    env.result.text.length > 200
      ? env.result.text.slice(0, 200) + "…"
      : env.result.text;

  stderrLog.info(`[${env.agentId}] status: ${env.status}`);
  if (preview) stderrLog.info(`result: ${preview}`);
  for (const artifact of env.artifacts) {
    stderrLog.info(
      `artifact: ${artifact.type}${artifact.url ? " → " + artifact.url : ""}`,
    );
  }
}

export function statusToExitCode(env: NodeEnvelope): number {
  switch (env.status) {
    case "ok":
    case "needs-input":
      return 0;
    case "error":
      return 1;
    default:
      return 1;
  }
}

export function exitWith(env: NodeEnvelope): never {
  process.exit(statusToExitCode(env));
}

export async function runVerb(
  args: { envelope?: string; json?: boolean },
  engineFn: (env: NodeEnvelope) => Promise<NodeEnvelope>,
): Promise<never> {
  const json = args.json ?? false;
  if (json) redirectConsolaToStderr();

  const inputResult = await readInputEnvelope(args);

  if ("error" in inputResult) {
    stderrLog.error(`Input error: ${inputResult.error}`);
    process.exit(2);
  }

  const fake = process.env.STO_FAKE_ENGINE;
  if (fake) {
    const status: NodeEnvelope["status"] =
      fake === "needs-input" ? "needs-input" : fake === "error" ? "error" : "ok";
    const resultEnv: NodeEnvelope = { ...inputResult.envelope, status };
    writeResult(resultEnv, { json });
    process.exit(statusToExitCode(resultEnv));
  }

  const resultEnv = await engineFn(inputResult.envelope).catch((err) => {
    stderrLog.error(`Engine error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  writeResult(resultEnv, { json });
  process.exit(statusToExitCode(resultEnv));
}
