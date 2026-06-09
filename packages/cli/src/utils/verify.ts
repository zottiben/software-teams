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

/**
 * Run quality gates defined in adapter.yaml.
 * Returns results for each gate with pass/fail status.
 */
export async function runQualityGates(cwd: string): Promise<VerificationResult> {
  const adapter = await readAdapter(cwd);
  if (!adapter?.quality_gates) {
    return { passed: true, gates: [] };
  }

  const gates: GateResult[] = [];

  for (const [name, command] of Object.entries(adapter.quality_gates)) {
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
    } catch (err: any) {
      gates.push({
        name,
        command: cmd,
        passed: false,
        output: err.message ?? "Failed to execute",
      });
    }
  }

  return {
    passed: gates.every((g) => g.passed),
    gates,
  };
}
