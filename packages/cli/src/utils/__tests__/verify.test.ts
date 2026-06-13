import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runQualityGates } from "../verify";

// adapter.yaml lives at .software-teams/config/adapter.yaml relative to cwd.
async function writeAdapter(dir: string, gates: Record<string, string>): Promise<void> {
  const configDir = join(dir, ".software-teams", "config");
  await mkdir(configDir, { recursive: true });
  const body = ["quality_gates:"]
    .concat(Object.entries(gates).map(([k, v]) => `  ${k}: "${v}"`))
    .join("\n");
  await writeFile(join(configDir, "adapter.yaml"), body + "\n", "utf8");
}

describe("runQualityGates filtering", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "st-verify-"));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test("passes when no adapter / no gates configured", async () => {
    const result = await runQualityGates(dir);
    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(0);
  });

  test("runs every gate by default", async () => {
    await writeAdapter(dir, { lint: "true", test: "true" });
    const result = await runQualityGates(dir);
    expect(result.passed).toBe(true);
    expect(result.gates.map((g) => g.name).sort()).toEqual(["lint", "test"]);
  });

  test("only=[lint] runs just the lint gate", async () => {
    await writeAdapter(dir, { lint: "true", test: "false" });
    const result = await runQualityGates(dir, { only: ["lint"] });
    expect(result.gates.map((g) => g.name)).toEqual(["lint"]);
    expect(result.passed).toBe(true); // test=false excluded, so overall passes
  });

  test("skip=[test] excludes the failing test gate", async () => {
    await writeAdapter(dir, { lint: "true", analyse: "true", test: "false" });
    const result = await runQualityGates(dir, { skip: ["test"] });
    expect(result.gates.map((g) => g.name).sort()).toEqual(["analyse", "lint"]);
    expect(result.passed).toBe(true);
  });

  test("reports failure (non-zero exit) for a failing gate", async () => {
    await writeAdapter(dir, { lint: "false" });
    const result = await runQualityGates(dir);
    expect(result.passed).toBe(false);
    expect(result.gates[0]!.passed).toBe(false);
  });
});
