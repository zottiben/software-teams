import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFrameworkFiles } from "../copy-framework";
import { readFile } from "node:fs/promises";

// All fixtures live in tmpdir. We pass `frameworkDirOverride` to
// copyFrameworkFiles so it never touches the real src/ tree (which would be
// catastrophic — `import.meta.dir/../framework` resolves to src/framework
// during tests, and the original test created sibling agents/+commands/ at
// src/agents+src/commands, accidentally overlapping with real source dirs
// after the plugin-tree promotion).

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-cf-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Build a minimal package-shape fixture. After Phase A retired the
 * `framework/` wrapper, every subtree (templates, teams, hooks, stacks,
 * adapters, agents, skills, ...) lives directly at the package root.
 * Returns the package root so callers pass it as `packageRootOverride`.
 */
function makePackageFixture(): { packageRoot: string } {
  const packageRoot = makeTempDir();

  mkdirSync(join(packageRoot, "adapters"), { recursive: true });
  mkdirSync(join(packageRoot, "teams"), { recursive: true });
  mkdirSync(join(packageRoot, "rules"), { recursive: true });
  mkdirSync(join(packageRoot, "agents"), { recursive: true });
  mkdirSync(join(packageRoot, "skills", "create-plan"), { recursive: true });
  mkdirSync(join(packageRoot, "skills", "create-dev-plan"), { recursive: true });
  mkdirSync(join(packageRoot, "skills", "st-support"), { recursive: true });

  writeFileSync(join(packageRoot, "software-teams.md"), "# Software Teams Framework");
  writeFileSync(join(packageRoot, "teams", "engineering.md"), "# Engineering");
  writeFileSync(join(packageRoot, "adapters", "generic.yaml"), "dependency_install: npm install");
  writeFileSync(join(packageRoot, "adapters", "node.yaml"), "dependency_install: bun install");
  writeFileSync(join(packageRoot, "rules", "general.md"), "---\npaths:\n  - \"**/*\"\n---\n# General Rules");
  writeFileSync(join(packageRoot, "rules", "software-teams.md"), "# Orchestration Rules");
  writeFileSync(join(packageRoot, "agents", "software-teams-planner.md"), "# Planner");
  writeFileSync(join(packageRoot, "skills", "create-plan", "SKILL.md"), "# Create Plan");
  writeFileSync(join(packageRoot, "skills", "create-dev-plan", "SKILL.md"), "# Create Dev Plan");
  writeFileSync(join(packageRoot, "skills", "st-support", "runtime.md"), "# Runtime");

  return { packageRoot };
}

describe("copyFrameworkFiles", () => {
  test("installs native rules without a bespoke .software-teams/rules mirror", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(existsSync(join(dir, ".claude", "rules", "general.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "rules", "software-teams.md"))).toBe(true);
    expect(existsSync(join(dir, ".software-teams", "rules"))).toBe(false);
    expect(existsSync(join(dir, ".software-teams", "templates"))).toBe(false);
    expect(existsSync(join(dir, ".software-teams", "framework"))).toBe(false);
  });

  test("copies native skills to collision-safe .claude/skills/st-*/ directories", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(existsSync(join(dir, ".claude", "skills", "st-create-plan", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "st-support", "runtime.md"))).toBe(true);
  });

  test("creates CLAUDE.md with routing header when not present", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const claudeMd = join(dir, ".claude", "CLAUDE.md");
    expect(existsSync(claudeMd)).toBe(true);
    const content = await Bun.file(claudeMd).text();
    expect(content).toContain("## Software Teams Workflow Routing");
  });

  test("does not overwrite existing CLAUDE.md that already has routing", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const original = "# My Project\n\n## Agent-First Default\n\nCustom routing content";
    writeFileSync(join(claudeDir, "CLAUDE.md"), original);

    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toBe(original);
  });

  test("appends routing to existing CLAUDE.md without routing header", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# My Project\n\nSome content.");

    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toContain("# My Project");
    expect(content).toContain("## Agent-First Default");
  });

  test("applies adapter config for the detected project type", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "node", false, false, packageRoot);

    const adapterPath = join(dir, ".software-teams", "config", "adapter.yaml");
    expect(existsSync(adapterPath)).toBe(true);
    const content = await Bun.file(adapterPath).text();
    expect(content).toContain("bun install");
  });

  test("does NOT generate .software-teams/framework/ mirror (Phase B retirement)", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    // Phase B retired the consumer-side framework/ wrapper; verify nothing
    // gets written there.
    expect(existsSync(join(dir, ".software-teams", "framework"))).toBe(false);
  });

  test("preserves learned native rules even when force=true", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const customPath = join(dir, ".claude", "rules", "general.md");
    await Bun.write(customPath, "---\npaths:\n  - \"**/*\"\n---\n# Custom team rule\n");

    await copyFrameworkFiles(dir, "generic", true, false, packageRoot);

    expect(await Bun.file(customPath).text()).toContain("Custom team rule");
  });

  test("refreshes framework-owned native doctrine on every init", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const doctrine = join(dir, ".claude", "rules", "software-teams.md");
    await Bun.write(doctrine, "STALE");
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(await Bun.file(doctrine).text()).toBe("# Orchestration Rules");
  });

  test("propagates skill directories verbatim to .claude/skills/st-*/", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    const sourceContent =
      "# Custom Skill\n\nLine with `TeamCreate(team_name: \"slug-team\")` token.\n";
    mkdirSync(join(packageRoot, "skills", "custom"), { recursive: true });
    writeFileSync(join(packageRoot, "skills", "custom", "SKILL.md"), sourceContent);

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const synced = await Bun.file(join(dir, ".claude", "skills", "st-custom", "SKILL.md")).text();
    expect(synced).toBe(sourceContent);
  });

  test("copies settings.json and wires the SubagentStop quality-gate hook", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    const templatesClaude = join(packageRoot, "templates", ".claude");
    mkdirSync(templatesClaude, { recursive: true });
    const settingsContent = '{"allowedTools":["Read","Write"],"hooks":{}}\n';
    writeFileSync(join(templatesClaude, "settings.json"), settingsContent);

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const dest = join(dir, ".claude", "settings.json");
    expect(existsSync(dest)).toBe(true);
    const parsed = JSON.parse(await Bun.file(dest).text());
    // Allowlist preserved from the template ...
    expect(parsed.allowedTools).toEqual(["Read", "Write"]);
    // ... and the deterministic quality-gate hook is wired on SubagentStop.
    const cmds = (parsed.hooks?.SubagentStop ?? []).flatMap(
      (e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command),
    );
    expect(cmds).toContain(".claude/hooks/quality-gate.sh");
  });

  test("merges the quality-gate hook into an EXISTING settings.json (upgrade path)", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    // Simulate an already-initialised project with a customised settings.json
    // and NO template settings.json (so the copy step won't overwrite it).
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), '{"allowedTools":["Read","Custom"],"hooks":{}}\n');

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const parsed = JSON.parse(await Bun.file(join(claudeDir, "settings.json")).text());
    expect(parsed.allowedTools).toEqual(["Read", "Custom"]); // user allowlist preserved
    const cmds = (parsed.hooks?.SubagentStop ?? []).flatMap(
      (e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command),
    );
    expect(cmds).toContain(".claude/hooks/quality-gate.sh");
  });

  test("refreshes framework-owned hook scripts on re-init (no stale copy kept)", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    const hooksDir = join(packageRoot, "templates", ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, "test-hook.sh"), "#!/usr/bin/env bash\n# v2\nexit 0\n");
    chmodSync(join(hooksDir, "test-hook.sh"), 0o755);

    // A stale copy already on disk (simulates a pre-upgrade project).
    const destHooks = join(dir, ".claude", "hooks");
    mkdirSync(destHooks, { recursive: true });
    writeFileSync(join(destHooks, "test-hook.sh"), "#!/usr/bin/env bash\n# v1 STALE\nexit 0\n");

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(await Bun.file(join(destHooks, "test-hook.sh")).text()).toContain("# v2");
  });

  test("copies templates/.claude/hooks/ to consumer's .claude/hooks/ preserving executable bit", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    const hooksDir = join(packageRoot, "templates", ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "test-hook.sh");
    writeFileSync(hookPath, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(hookPath, 0o755);

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const dest = join(dir, ".claude", "hooks", "test-hook.sh");
    expect(existsSync(dest)).toBe(true);
    expect(await Bun.file(dest).text()).toBe("#!/usr/bin/env bash\nexit 0\n");
    expect(statSync(dest).mode & 0o111).toBeGreaterThan(0);
  });

  test("removes retired generated commands during a native-skill upgrade", async () => {
    const dir = makeTempDir();
    const legacyDir = join(dir, ".claude", "commands", "st");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "create-plan.md"), "legacy");
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(existsSync(legacyDir)).toBe(false);
    const skillPath = join(dir, ".claude", "skills", "st-create-dev-plan", "SKILL.md");
    expect(await readFile(skillPath, "utf-8")).toBe("# Create Dev Plan");
  });
});
