import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PKG_DIR = path.resolve(__dirname, "..");
const VERIFIER = path.join(PKG_DIR, "scripts", "verify-node-load.cjs");
const PKG_JSON = path.join(PKG_DIR, "package.json");

const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8")) as {
  n8n: { nodes: string[]; credentials: string[] };
};

const allEntries: string[] = [
  ...(pkg.n8n.credentials ?? []),
  ...(pkg.n8n.nodes ?? []),
];

// The emitted JS path for the first node entry — used as the broken-fixture target.
const FIXTURE_ENTRY = pkg.n8n.nodes[0]!;
const FIXTURE_ABS = path.resolve(PKG_DIR, FIXTURE_ENTRY);

// Saved original bytes so teardown can restore exactly.
let originalBytes: Buffer;

function runVerifier(): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [VERIFIER], {
    cwd: PKG_DIR,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("node-load (AC1/AC6) — all nodes + credential load under Node", () => {
  test("T3 verifier exits 0 and reports 8/8 loaded", () => {
    const { exitCode, stdout } = runVerifier();
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/8\/8 loaded successfully/);
    for (const entry of allEntries) {
      expect(stdout).toContain(`PASS  ${entry}`);
    }
  });

  test("all 7 node entries + 1 credential are covered (8 total)", () => {
    expect(allEntries).toHaveLength(8);
    expect(pkg.n8n.credentials).toHaveLength(1);
    expect(pkg.n8n.nodes).toHaveLength(7);
  });
});

describe("broken-fixture (AC6) — verifier exits non-zero with actionable message", () => {
  beforeAll(() => {
    originalBytes = fs.readFileSync(FIXTURE_ABS);
    // Rewrite the file to mixed ESM/require format (the original failure mode).
    const mixed = [
      '"use strict";',
      "// intentionally broken: mixed ESM import + CJS require",
      "import { NodeConnectionTypes } from 'n8n-workflow';",
      "const n8nWorkflow = require('n8n-workflow');",
      "exports.BrokenNode = {};",
    ].join("\n");
    fs.writeFileSync(FIXTURE_ABS, mixed, "utf8");
  });

  afterAll(() => {
    // Restore unconditionally so corpus is byte-unchanged.
    fs.writeFileSync(FIXTURE_ABS, originalBytes);
  });

  test("verifier exits non-zero when a node has mixed ESM/require format", () => {
    const { exitCode } = runVerifier();
    expect(exitCode).not.toBe(0);
  });

  test("verifier stderr contains FAIL with the broken entry path", () => {
    const { stderr } = runVerifier();
    expect(stderr).toMatch(/FAIL\s+dist\/nodes\//);
    expect(stderr).toContain(FIXTURE_ENTRY);
  });

  test("verifier stderr contains an actionable error message", () => {
    const { stderr } = runVerifier();
    // Node will surface a SyntaxError or ERR_REQUIRE_ESM on mixed-format files.
    expect(stderr.length).toBeGreaterThan(0);
    // At least one of the known error strings must appear.
    const known = [
      "SyntaxError",
      "ERR_REQUIRE_ESM",
      "require is not defined",
      "Cannot use import statement",
    ];
    const hasKnown = known.some((s) => stderr.includes(s));
    expect(hasKnown).toBe(true);
  });
});

describe("CJS-emit (AC2) — emitted node JS contains no ESM import/export statements", () => {
  for (const entry of allEntries) {
    const absPath = path.resolve(PKG_DIR, entry);
    test(`${entry} has no top-level ESM import/export`, () => {
      const src = fs.readFileSync(absPath, "utf8");
      // Match bare `import ` or `export ` at line-start (not inside strings).
      expect(src).not.toMatch(/^import /m);
      expect(src).not.toMatch(/^export /m);
      expect(src).not.toMatch(/^export default /m);
    });

    test(`${entry} begins with "use strict" (CJS marker)`, () => {
      const src = fs.readFileSync(absPath, "utf8");
      expect(src.trimStart()).toMatch(/^["']use strict["']/);
    });
  }
});
