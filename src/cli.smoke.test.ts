import { describe, test, expect, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const DIST_PATH = join(REPO_ROOT, "dist", "index.js");

describe("CLI smoke tests — wave 1 rebrand", () => {
  beforeAll(async () => {
    // Ensure dist/index.js is built
    if (!existsSync(DIST_PATH)) {
      console.log("Building dist/index.js for smoke tests...");
      execSync("bun run build", { cwd: REPO_ROOT, stdio: "inherit" });
    }
  });

  test("bun run dist/index.js --version returns a version string", async () => {
    const output = execSync(`bun run ${DIST_PATH} --version`).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    // Version format is typically "x.y.z" or similar
    expect(output).toMatch(/\d+\.\d+/);
  });

  test("--version output does not crash", async () => {
    const output = execSync(`bun run ${DIST_PATH} --version`).toString();
    // Version should be printed without error
    expect(output.length).toBeGreaterThan(0);
  });

  test("bun run dist/index.js --help lists software-teams commands", async () => {
    const output = execSync(`bun run ${DIST_PATH} --help`).toString();
    expect(output.length).toBeGreaterThan(0);
    // Must list the CLI binary name
    expect(output).toMatch(/software-teams/);
  });

  test("--help output lists init, sync-agents, plan, implement commands", async () => {
    const output = execSync(`bun run ${DIST_PATH} --help`).toString();
    expect(output).toMatch(/init/i);
    expect(output).toMatch(/sync-agents/i);
    expect(output).toMatch(/plan/i);
    expect(output).toMatch(/implement/i);
  });

  test("bun run dist/index.js with no args prints help or error (does not crash)", async () => {
    try {
      const output = execSync(`bun run ${DIST_PATH}`, { stdio: "pipe" }).toString();
      // Either prints help or a message; as long as it doesn't throw, it's OK
      expect(output).toBeDefined();
    } catch (err: any) {
      // Some CLIs exit with code 1 for no args; that's acceptable
      // As long as stderr/stdout have content (not a silent crash)
      expect((err.stderr ?? err.stdout ?? "").length).toBeGreaterThan(0);
    }
  });
});
