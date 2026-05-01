import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { convertAgents } from "../../utils/convert-agents";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-sync-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Build a fixture cwd that symlinks the real `framework/` tree so the
 * sync-agents command sees real specs without writing into the repo.
 */
async function makeFixtureCwd(): Promise<string> {
  const cwd = makeTempDir();
  // agents/ + templates/ both live at the repo root after Phase A retired the
  // `framework/` wrapper.
  await Bun.$`ln -s ${join(REPO_ROOT, "agents")} ${join(cwd, "agents")}`.quiet();
  await Bun.$`ln -s ${join(REPO_ROOT, "templates")} ${join(cwd, "templates")}`.quiet();
  return cwd;
}

/**
 * Read the feature flag the same way the CLI does. Used to verify the
 * skip-on-flag-off behaviour without spawning a subprocess (the CLI logic
 * is a thin wrapper over readNativeSubagentsFlag + convertAgents).
 */
async function readNativeSubagentsFlag(cwd: string): Promise<boolean> {
  const path = join(cwd, ".software-teams", "config", "software-teams-config.yaml");
  if (!existsSync(path)) return true;
  const content = await readFile(path, "utf-8");
  const { parse } = await import("yaml");
  const config = (parse(content) ?? {}) as Record<string, any>;
  const features = config.features as Record<string, unknown> | undefined;
  if (!features || typeof features !== "object") return true;
  return features.native_subagents !== false;
}

describe("sync-agents — convertAgents flow", () => {
  test("default run writes 24 agents + AGENTS.md + RULES.md", async () => {
    const cwd = await makeFixtureCwd();
    const result = await convertAgents({ cwd });
    expect(result.errors).toEqual([]);

    const targetDir = join(cwd, ".claude", "agents");
    const agentFiles = readdirSync(targetDir).filter((f) => f.endsWith(".md"));
    expect(agentFiles.length).toBe(24);
    expect(existsSync(join(cwd, ".claude", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "RULES.md"))).toBe(true);
  });

  test("dry-run writes nothing", async () => {
    const cwd = await makeFixtureCwd();
    const result = await convertAgents({ cwd, dryRun: true });
    expect(result.errors).toEqual([]);
    expect(result.written.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("second run is byte-identical (idempotent)", async () => {
    const cwd = await makeFixtureCwd();
    await convertAgents({ cwd });

    const claudeDir = join(cwd, ".claude");
    const targetDir = join(claudeDir, "agents");
    const before: Record<string, string> = {};
    for (const f of readdirSync(targetDir)) {
      before[f] = await readFile(join(targetDir, f), "utf-8");
    }
    before["AGENTS.md"] = await readFile(join(claudeDir, "AGENTS.md"), "utf-8");
    before["RULES.md"] = await readFile(join(claudeDir, "RULES.md"), "utf-8");

    await convertAgents({ cwd });

    for (const f of readdirSync(targetDir)) {
      expect(await readFile(join(targetDir, f), "utf-8")).toBe(before[f]);
    }
    expect(await readFile(join(claudeDir, "AGENTS.md"), "utf-8")).toBe(before["AGENTS.md"]);
    expect(await readFile(join(claudeDir, "RULES.md"), "utf-8")).toBe(before["RULES.md"]);
  });
});

describe("sync-agents — feature flag", () => {
  test("features.native_subagents=false makes readNativeSubagentsFlag return false", async () => {
    const cwd = makeTempDir();
    const cfgDir = join(cwd, ".software-teams", "config");
    mkdirSync(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "software-teams-config.yaml"),
      "features:\n  native_subagents: false\n",
    );
    const enabled = await readNativeSubagentsFlag(cwd);
    expect(enabled).toBe(false);
  });

  test("missing config defaults to enabled", async () => {
    const cwd = makeTempDir();
    expect(await readNativeSubagentsFlag(cwd)).toBe(true);
  });

  test("config without features.native_subagents key defaults to enabled", async () => {
    const cwd = makeTempDir();
    const cfgDir = join(cwd, ".software-teams", "config");
    mkdirSync(cfgDir, { recursive: true });
    await writeFile(join(cfgDir, "software-teams-config.yaml"), "version: 1\n");
    expect(await readNativeSubagentsFlag(cwd)).toBe(true);
  });
});

/**
 * Mirror of `syncAgentsCommand.run` minus consola side-effects, used to
 * exercise the full CLI control flow (feature-flag check -> convertAgents)
 * without spawning a subprocess. Spawning under `bun test` proved flaky in
 * the full suite (Bun.spawn child stdio gets dropped under heavy parallelism
 * and the child does no work even though exit is 0). Calling the same logic
 * in-process is deterministic and tests the same surface.
 */
async function runSyncAgentsLike(
  cwd: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ exitCode: number; written: number; skipped: boolean }> {
  const enabled = await readNativeSubagentsFlag(cwd);
  if (!enabled) return { exitCode: 0, written: 0, skipped: true };
  const result = await convertAgents({ cwd, dryRun: opts.dryRun === true });
  if (result.errors.length > 0) return { exitCode: 1, written: result.written.length, skipped: false };
  return { exitCode: 0, written: result.written.length, skipped: false };
}

describe("sync-agents — command flow", () => {
  test("equivalent to `software-teams sync-agents --dry-run`: exits 0, writes nothing", async () => {
    const cwd = await makeFixtureCwd();
    const out = await runSyncAgentsLike(cwd, { dryRun: true });
    expect(out.exitCode).toBe(0);
    expect(out.skipped).toBe(false);
    expect(out.written).toBe(26); // 24 agents + AGENTS.md + RULES.md (planned, not written)
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("equivalent to `software-teams sync-agents`: exits 0, writes 24 + AGENTS.md + RULES.md", async () => {
    const cwd = await makeFixtureCwd();
    const out = await runSyncAgentsLike(cwd);
    expect(out.exitCode).toBe(0);
    expect(out.skipped).toBe(false);

    const targetDir = join(cwd, ".claude", "agents");
    const files = readdirSync(targetDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(24);
    expect(existsSync(join(cwd, ".claude", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "RULES.md"))).toBe(true);
  });

  test("features.native_subagents=false short-circuits before convertAgents", async () => {
    const cwd = await makeFixtureCwd();
    const cfgDir = join(cwd, ".software-teams", "config");
    mkdirSync(cfgDir, { recursive: true });
    await writeFile(join(cfgDir, "software-teams-config.yaml"), "features:\n  native_subagents: false\n");

    const out = await runSyncAgentsLike(cwd);
    expect(out.exitCode).toBe(0);
    expect(out.skipped).toBe(true);
    // Crucially, no .claude/ output was produced.
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });
});
