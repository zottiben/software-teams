import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const PKG_DIR = path.resolve(__dirname, "..");

/**
 * Run a one-liner Node script with CWD = packages/n8n/ (ADR-003 Decision 4:
 * host-equivalent resolution boundary).
 */
function nodeEval(script: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: PKG_DIR,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

describe("AC4 — shared lib resolves as CJS (require condition)", () => {
  test("require('@websitelabs/software-teams') resolves to lib/n8n-api.js", () => {
    const { stdout, exitCode } = nodeEval(
      `const r = require.resolve('@websitelabs/software-teams'); process.stdout.write(r);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("lib/n8n-api.js");
    // Must NOT resolve to TS source.
    expect(stdout).not.toContain("src/n8n-api.ts");
  });

  test("require('@websitelabs/software-teams') does NOT execute .ts source", () => {
    const { stdout, exitCode } = nodeEval(
      `const r = require.resolve('@websitelabs/software-teams'); process.stdout.write(r);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/\.ts$/);
  });

  test("resolved lib exposes slugify export", () => {
    const { stdout, exitCode } = nodeEval(
      `const m = require('@websitelabs/software-teams'); process.stdout.write(typeof m.slugify);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("function");
  });

  test("resolved lib exposes sanitizeUserInput export", () => {
    const { stdout, exitCode } = nodeEval(
      `const m = require('@websitelabs/software-teams'); process.stdout.write(typeof m.sanitizeUserInput);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("function");
  });

  test("resolved lib is a plain object (CJS exports)", () => {
    const { stdout, exitCode } = nodeEval(
      `const m = require('@websitelabs/software-teams'); process.stdout.write(typeof m);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("object");
  });
});

describe("AC5 — n8n-workflow peer resolves to CJS build (dist/cjs)", () => {
  test("require.resolve('n8n-workflow') path contains dist/cjs", () => {
    const { stdout, exitCode } = nodeEval(
      `const r = require.resolve('n8n-workflow'); process.stdout.write(r);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dist/cjs");
    // Must NOT resolve to ESM build.
    expect(stdout).not.toContain("dist/esm");
  });

  test("n8n-workflow resolves under Node (not Bun-install ESM path)", () => {
    const { stdout, exitCode } = nodeEval(
      `const r = require.resolve('n8n-workflow'); process.stdout.write(r.includes('dist/esm') ? 'esm' : 'cjs');`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("cjs");
  });

  test("n8n-workflow CJS build loads without error", () => {
    const { exitCode, stderr } = nodeEval(
      `require('n8n-workflow');`,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  test("n8n-workflow exposes NodeConnectionTypes (used by all nodes)", () => {
    const { stdout, exitCode } = nodeEval(
      `const m = require('n8n-workflow'); process.stdout.write(typeof m.NodeConnectionTypes);`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("object");
  });
});
