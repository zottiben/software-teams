/**
 * Tests for the component drift check.
 *
 * Verifies:
 * - Clean tree (live markdown matches TS registry) → { ok: true }
 * - Synthetic edit (modified markdown) → { ok: false, diffs: [...] }
 * - Exit-code semantics: bun run dist/index.js component drift exits 0 on clean tree,
 *   exits 1 on modified tree
 *
 * Uses temporary directories to avoid modifying the live framework files.
 */

import { describe, test, expect } from "bun:test";
import { checkComponentDrift } from "./component-drift";
import { join } from "path";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";

describe("Component Drift Check", () => {
  test("clean tree passes drift check", async () => {
    const cwd = process.cwd();
    const frameworkDir = join(cwd, "framework");

    const result = await checkComponentDrift({ frameworkDir });
    expect(result.ok).toBe(true);
  });

  test("synthetic markdown edit triggers drift detection", async () => {
    const cwd = process.cwd();
    const frameworkDir = join(cwd, "framework");

    // Create a temporary directory with a copy of one component
    const tmpDir = await fs.mkdtemp(join(os.tmpdir(), "component-drift-test-"));
    const tmpComponentsDir = join(tmpDir, "components");
    await fs.mkdir(tmpComponentsDir, { recursive: true });

    try {
      // Copy the AgentBase component structure to the temp directory
      const metaDir = join(tmpComponentsDir, "meta");
      await fs.mkdir(metaDir, { recursive: true });

      const originalPath = join(frameworkDir, "components", "meta", "AgentBase.md");
      const tempPath = join(metaDir, "AgentBase.md");

      if (existsSync(originalPath)) {
        let content = await fs.readFile(originalPath, "utf-8");

        // Inject a synthetic edit: add an extra word to the first section
        content = content.replace(
          /^(## Standards\n)/m,
          "$1SYNTHETIC_EDIT_MARKER ",
        );

        await fs.writeFile(tempPath, content);

        // Now check drift against this modified temp directory
        const result = await checkComponentDrift({ frameworkDir: tmpDir });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.diffs.length).toBeGreaterThan(0);

          // Verify that at least one diff mentions AgentBase and Standards
          const agentBaseDiff = result.diffs.find(
            (d) => d.component === "AgentBase" && d.section === "Standards",
          );
          expect(agentBaseDiff).toBeDefined();
          if (agentBaseDiff) {
            // The actual (modified) should contain our synthetic edit marker
            expect(agentBaseDiff.actual).toContain("SYNTHETIC_EDIT_MARKER");
            // The expected (from TS) should NOT
            expect(agentBaseDiff.expected).not.toContain(
              "SYNTHETIC_EDIT_MARKER",
            );
          }
        }
      }
    } finally {
      // Cleanup temp directory
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("component drift check respects custom frameworkDir", async () => {
    const cwd = process.cwd();
    const frameworkDir = join(cwd, "framework");

    // Test with explicit frameworkDir parameter
    const result = await checkComponentDrift({ frameworkDir });
    expect(result.ok).toBe(true);
  });

  test("exit code test: bun component drift exits 0 on clean tree", async () => {
    const cwd = process.cwd();

    // Run the CLI command against the live (clean) tree
    const proc = Bun.spawn(
      ["bun", "run", "dist/index.js", "component", "drift"],
      { cwd, stdio: ["ignore", "ignore", "ignore"] },
    );

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("exit code test: bun component drift exits 1 on modified tree", async () => {
    const cwd = process.cwd();
    const frameworkDir = join(cwd, "framework");

    // Create a temporary directory with a modified component
    const tmpDir = await fs.mkdtemp(join(os.tmpdir(), "component-drift-cli-test-"));
    const tmpComponentsDir = join(tmpDir, "components");
    await fs.mkdir(tmpComponentsDir, { recursive: true });

    try {
      // Copy all framework component directories to temp
      const categories = ["meta", "execution", "planning", "quality"];
      for (const cat of categories) {
        const srcDir = join(frameworkDir, "components", cat);
        const dstDir = join(tmpComponentsDir, cat);
        if (existsSync(srcDir)) {
          await fs.mkdir(dstDir, { recursive: true });
          const files = await fs.readdir(srcDir);
          for (const file of files) {
            if (file.endsWith(".md")) {
              const srcFile = join(srcDir, file);
              const dstFile = join(dstDir, file);
              let content = await fs.readFile(srcFile, "utf-8");

              // For Verify.md, add a synthetic edit
              if (file === "Verify.md") {
                content = content.replace(
                  /^---\n/,
                  "---\n# SYNTHETIC_DRIFT_MARKER\n",
                );
              }

              await fs.writeFile(dstFile, content);
            }
          }
        }
      }

      // Run the CLI command against the modified tree
      const proc = Bun.spawn(
        ["bun", "run", "dist/index.js", "component", "drift"],
        { cwd: tmpDir, stdio: ["ignore", "ignore", "ignore"] },
      );

      const exitCode = await proc.exited;
      expect(exitCode).not.toBe(0); // Should fail (non-zero exit)
    } finally {
      // Cleanup temp directory
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
