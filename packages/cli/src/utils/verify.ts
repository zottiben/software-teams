import { readAdapter } from "./adapter";

export interface GateResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface VerificationResult {
  passed: boolean;
  gates: GateResult[];
}

export interface QualityGateOptions {
  /** When non-empty, run ONLY gates whose name is in this list. */
  only?: string[];
  /** Gate names to exclude (applied after `only`). */
  skip?: string[];
}

/**
 * Run quality gates defined in adapter.yaml.
 * Returns results for each gate with pass/fail status.
 *
 * `options.only` / `options.skip` filter which gates run — used by the
 * `software-teams verify` command and the SubagentStop quality-gate hook to
 * run the fast gates (lint / analyse) per specialist while leaving the full
 * test suite to the QA-tester gate. Default (no options) runs every gate, so
 * existing callers are unaffected.
 */
export async function runQualityGates(
  cwd: string,
  options: QualityGateOptions = {},
): Promise<VerificationResult> {
  const adapter = await readAdapter(cwd);
  if (!adapter?.quality_gates) {
    return { passed: true, gates: [] };
  }

  const { only, skip } = options;
  const selected = Object.entries(adapter.quality_gates).filter(([name]) => {
    if (only && only.length > 0 && !only.includes(name)) return false;
    if (skip && skip.includes(name)) return false;
    return true;
  });

  const gates: GateResult[] = [];

  for (const [name, command] of selected) {
    const cmd = String(command);
    try {
      const proc = Bun.spawn(["sh", "-c", cmd], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      gates.push({
        name,
        command: cmd,
        passed: exitCode === 0,
        output: (stdout + stderr).trim(),
      });
    } catch (err: unknown) {
      gates.push({
        name,
        command: cmd,
        passed: false,
        output: err instanceof Error ? err.message : "Failed to execute",
      });
    }
  }

  return {
    passed: gates.every((g) => g.passed),
    gates,
  };
}
