/**
 * Shared envelope-I/O helper — T2 of plan 1-02-n8n-manual-cli.
 *
 * Every CLI verb (agent-turn, orchestrator-turn, ingest, output) imports this
 * module for input resolution, output routing, and exit-code mapping.
 *
 * Normative sources:
 *  - Input resolution  → CLI-RECIPE.md §2
 *  - Output rule       → CLI-RECIPE.md §3  (json-purity-gate spine, R-09)
 *  - Exit-code mapping → CLI-RECIPE.md §4  (exit-code-gate spine)
 *
 * REUSE: `NodeEnvelope` is imported from the existing contract module;
 * no type re-definition occurs here.  A minimal runtime invariant guard
 * (`isNodeEnvelope`) is included because the contract module exports only
 * TypeScript types — there is no runtime validator to import.  This is
 * flagged as a justified deviation in the T2 report.
 */

import type { NodeEnvelope } from "../../n8n/src/contract/envelope";
import { consola, createConsola } from "consola";

// ─── stderr-only diagnostic logger ───────────────────────────────────────────
//
// Used for ALL diagnostics (both modes) so they never contaminate stdout.
// Exported so verbs can log progress/errors through the same channel.

// NOTE: consola expects *streams* here, not booleans — `{ stderr: true }`
// crashes consola's writeStream at runtime (caught by post-task-verify smoke).
// Point BOTH streams at stderr so every level stays off stdout.
export const stderrLog = createConsola({
  stdout: process.stderr,
  stderr: process.stderr,
});

// ─── stdout purity (R-09) ────────────────────────────────────────────────────

/**
 * Redirect the global `consola` singleton to write to stderr instead of stdout.
 *
 * Call this once, early in any `--json` verb run.  After this call, any
 * accidental `consola.log / .info / .warn` anywhere in the process writes to
 * stderr and cannot contaminate the stdout envelope line.
 */
export function redirectConsolaToStderr(): void {
  // consola's built-in reporter writes to options.stdout; swapping the stream
  // is the minimal, zero-dependency way to guarantee stdout purity.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (consola as unknown as { options: { stdout: NodeJS.WritableStream } }).options.stdout =
    process.stderr;
}

// ─── runtime envelope invariant guard ───────────────────────────────────────
//
// The contract module (`n8n/src/contract/envelope.ts`) exports only TypeScript
// types — no runtime validator exists to import.  This guard implements the
// six-field §1 invariants from CONTRACT.md.
// Deviation flagged in T2 report: no existing validator to reuse.

function isNodeEnvelope(obj: unknown): obj is NodeEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const e = obj as Record<string, unknown>;

  // Required top-level fields
  if (typeof e.correlationId !== "string" || e.correlationId.length === 0) return false;
  if (typeof e.agentId !== "string") return false;
  if (!["ok", "error", "needs-input"].includes(e.status as string)) return false;

  // input: { prompt: string; context: unknown }
  if (typeof e.input !== "object" || e.input === null) return false;
  if (typeof (e.input as Record<string, unknown>).prompt !== "string") return false;

  // result: { text: string }
  if (typeof e.result !== "object" || e.result === null) return false;
  if (typeof (e.result as Record<string, unknown>).text !== "string") return false;

  // artifacts: ArtifactRef[]
  if (!Array.isArray(e.artifacts)) return false;

  return true;
}

// ─── input resolution ────────────────────────────────────────────────────────

/** Typed result returned by `readInputEnvelope`. */
export type InputResult = { envelope: NodeEnvelope } | { error: string };

/**
 * Options for `readInputEnvelope`.
 * `readStdin` is injectable for unit testing; defaults to `Bun.stdin.text()`.
 */
export interface ReadInputOptions {
  /** Override the stdin reader (used in tests to avoid blocking on real stdin). */
  readStdin?: () => Promise<string>;
}

/**
 * Resolve the input envelope per CLI-RECIPE.md §2.
 *
 * Precedence (strict — no fallback past a failed parse):
 *  1. `args.envelope` string (the `--envelope <json>` flag)
 *  2. stdin read-to-EOF (absent when stdin is a TTY or yields empty content)
 *  3. error (exit 2 — caller's responsibility to surface)
 *
 * Returns `{ envelope }` on success or `{ error: string }` on any failure.
 * Never throws past the caller boundary.
 */
export async function readInputEnvelope(
  args: { envelope?: string },
  options?: ReadInputOptions,
): Promise<InputResult> {
  const readStdin = options?.readStdin ?? (() => Bun.stdin.text());

  // ── Precedence 1: --envelope flag ──────────────────────────────────────────
  if (args.envelope !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.envelope);
    } catch {
      return { error: "--envelope value is not valid JSON" };
    }
    if (!isNodeEnvelope(parsed)) {
      return { error: "--envelope value does not satisfy NodeEnvelope invariants" };
    }
    return { envelope: parsed };
  }

  // ── Precedence 2: stdin ────────────────────────────────────────────────────
  //
  // Stdin is considered absent (→ error) when:
  //  (a) stdin is a TTY (interactive invocation — do not block)
  //  (b) read-to-EOF yields zero bytes or whitespace only
  if (process.stdin.isTTY) {
    return {
      error:
        "No input envelope: stdin is a TTY and --envelope was not supplied",
    };
  }

  let raw: string;
  try {
    raw = (await readStdin()).trim();
  } catch {
    return { error: "Failed to read stdin" };
  }

  if (raw.length === 0) {
    return {
      error:
        "No input envelope: stdin was empty and --envelope was not supplied",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "stdin content is not valid JSON" };
  }

  if (!isNodeEnvelope(parsed)) {
    return { error: "stdin content does not satisfy NodeEnvelope invariants" };
  }

  return { envelope: parsed };
}

// ─── output ──────────────────────────────────────────────────────────────────

/**
 * Emit the resulting envelope per CLI-RECIPE.md §3.
 *
 * `--json` mode (`opts.json === true`):
 *   Writes exactly `JSON.stringify(env) + "\n"` to **stdout** and returns.
 *   Nothing else may reach stdout — consola must have been redirected to
 *   stderr before this call (see `redirectConsolaToStderr` / `runVerb`).
 *
 * Human mode (`opts.json === false`, default):
 *   Writes a consola summary (status, result preview, artifact URLs) to
 *   **stderr**.  Stdout receives nothing — it stays clean for any downstream
 *   piping even in human mode.
 */
export function writeResult(env: NodeEnvelope, opts: { json: boolean }): void {
  if (opts.json) {
    // Hard invariant: exactly one envelope line, nothing else.
    process.stdout.write(JSON.stringify(env) + "\n");
    return;
  }

  // Human mode — all output to stderr via stderrLog.
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

// ─── exit-code mapping ───────────────────────────────────────────────────────

/**
 * Map envelope `status` to a process exit code per CLI-RECIPE.md §4.
 *
 * ok / needs-input → 0   (valid outcomes, including HITL park)
 * error            → 1   (turn/engine failure; envelope carries the detail)
 *
 * Exit code 2 (unparseable / missing input) is NOT produced here — it is the
 * caller's responsibility when `readInputEnvelope` returns `{ error }`.
 */
export function statusToExitCode(env: NodeEnvelope): number {
  switch (env.status) {
    case "ok":
    case "needs-input":
      return 0;
    case "error":
      return 1;
    default:
      // Defensive floor for any unrecognised status value at runtime.
      return 1;
  }
}

/**
 * Map to exit code and call `process.exit`.  Convenience for verb `run`
 * functions that want a one-liner; separated from `statusToExitCode` so the
 * mapping stays unit-testable without spawning a subprocess.
 */
export function exitWith(env: NodeEnvelope): never {
  process.exit(statusToExitCode(env));
}

// ─── runVerb convenience ─────────────────────────────────────────────────────

/**
 * Tie read → engine → write → exit together for a verb body.
 *
 * Each verb passes its parsed args and its engine function; this helper
 * handles the full lifecycle so the verb body is a few lines of arg-wiring.
 *
 * Flow:
 *  1. If `--json`, redirect global consola to stderr (R-09 stdout purity).
 *  2. Resolve input via `readInputEnvelope`; on error → stderr + exit 2.
 *  3. Call `engineFn(envelope)`; on throw → stderr + exit 1.
 *  4. Emit result via `writeResult`.
 *  5. Exit with `statusToExitCode(result)`.
 */
export async function runVerb(
  args: { envelope?: string; json?: boolean },
  engineFn: (env: NodeEnvelope) => Promise<NodeEnvelope>,
): Promise<never> {
  const json = args.json ?? false;

  // Guarantee stdout purity for --json runs (R-09).
  if (json) redirectConsolaToStderr();

  const inputResult = await readInputEnvelope(args);

  if ("error" in inputResult) {
    stderrLog.error(`Input error: ${inputResult.error}`);
    process.exit(2);
  }

  // ── Test-only engine seam (offline e2e) ────────────────────────────────────
  // The recipe's process-level invariants (exit codes, --json stdout purity)
  // must be provable in a *spawned* subprocess, but every real engine needs the
  // `claude` binary or live network — which module-mocks cannot cross a spawn
  // boundary. When STO_FAKE_ENGINE is set (test-only, opt-in, never in prod),
  // the real engine is bypassed and the input envelope is echoed back with the
  // requested status. It reads no tokens and makes no network calls, so it
  // cannot leak secrets. Engine *payloads* remain covered by in-process tests.
  const fake = process.env.STO_FAKE_ENGINE;
  if (fake) {
    const status: NodeEnvelope["status"] =
      fake === "needs-input" ? "needs-input" : fake === "error" ? "error" : "ok";
    const resultEnv: NodeEnvelope = { ...inputResult.envelope, status };
    writeResult(resultEnv, { json });
    process.exit(statusToExitCode(resultEnv));
  }

  let resultEnv: NodeEnvelope;
  try {
    resultEnv = await engineFn(inputResult.envelope);
  } catch (err) {
    stderrLog.error(
      `Engine error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  writeResult(resultEnv, { json });
  process.exit(statusToExitCode(resultEnv));
}
