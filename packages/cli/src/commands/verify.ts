import { defineCommand } from "citty";
import { runQualityGates } from "../utils/verify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a comma-separated CLI value into a trimmed, non-empty name list. */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Cap a gate's captured output so hook context stays small. */
function truncate(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  const shown = lines.slice(0, maxLines).join("\n");
  return `${shown}\n… (${lines.length - maxLines} more line(s) truncated)`;
}

export interface VerifyOptions {
  only?: string[];
  skip?: string[];
  json?: boolean;
  /** Print only failing gates (and the final verdict on failure). */
  quiet?: boolean;
}

// ---------------------------------------------------------------------------
// verify() — the contract surface (callable from tests and the hook)
// ---------------------------------------------------------------------------

/**
 * Run the project's adapter quality gates and report the outcome.
 * Returns the process exit code: 0 = all selected gates passed (or none
 * configured), 1 = at least one gate failed.
 */
export async function verify(options: VerifyOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const result = await runQualityGates(cwd, {
    only: options.only,
    skip: options.skip,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.passed ? 0 : 1;
  }

  if (result.gates.length === 0) {
    if (!options.quiet) {
      console.log(
        "software-teams verify: no matching quality gates (check .software-teams/config/adapter.yaml).",
      );
    }
    return 0;
  }

  for (const gate of result.gates) {
    if (options.quiet && gate.passed) continue;
    console.log(`[${gate.passed ? "PASS" : "FAIL"}] ${gate.name} — ${gate.command}`);
    if (!gate.passed && gate.output) {
      console.log(truncate(gate.output, 40));
    }
  }

  if (!result.passed) {
    console.log("\nsoftware-teams verify: one or more quality gates FAILED.");
  } else if (!options.quiet) {
    console.log("\nsoftware-teams verify: all quality gates passed.");
  }

  return result.passed ? 0 : 1;
}

// ---------------------------------------------------------------------------
// citty subcommand definition
// ---------------------------------------------------------------------------

export const verifyCommand = defineCommand({
  meta: {
    name: "verify",
    description:
      "Run the project's adapter quality gates (lint / analyse / test) and exit non-zero on failure",
  },
  args: {
    gate: {
      type: "string",
      description: "Comma-separated gate names to run (default: all)",
      required: false,
    },
    skip: {
      type: "string",
      description: "Comma-separated gate names to skip (e.g. 'test')",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON instead of human-readable output",
      required: false,
    },
    quiet: {
      type: "boolean",
      description: "Print only failing gates (silent when everything passes)",
      required: false,
    },
  },
  async run({ args }) {
    const code = await verify({
      only: parseList(args.gate as string | undefined),
      skip: parseList(args.skip as string | undefined),
      json: Boolean(args.json),
      quiet: Boolean(args.quiet),
    });
    process.exit(code);
  },
});
