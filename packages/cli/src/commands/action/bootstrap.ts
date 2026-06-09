import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function ensureFramework(cwd: string): void {
  const phaseBState = join(cwd, ".software-teams/state.yaml");
  const legacyState = join(cwd, ".software-teams/config/state.yaml");
  const needsInit = !existsSync(phaseBState) && !existsSync(legacyState);
  if (needsInit) {
    consola.info("Framework not found — initializing...");
    const result = Bun.spawnSync(["bunx", "@websitelabs/software-teams@latest", "init", "--ci"], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      consola.error("Failed to initialize framework");
      process.exit(1);
    }
  }
  mkdirSync(join(cwd, ".software-teams/persistence"), { recursive: true });
}

export function clearStaleState(cwd: string): void {
  const plansDir = join(cwd, ".software-teams/plans");
  if (existsSync(plansDir)) {
    for (const entry of readdirSync(plansDir)) {
      rmSync(join(plansDir, entry), { recursive: true, force: true });
    }
  } else {
    mkdirSync(plansDir, { recursive: true });
  }

  const configDir = join(cwd, ".software-teams/config");
  mkdirSync(configDir, { recursive: true });
  const templatePath = join(cwd, ".software-teams", "framework", "config", "state.yaml");
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, "utf-8");
    writeFileSync(join(configDir, "state.yaml"), template);
  } else {
    writeFileSync(
      join(configDir, "state.yaml"),
      [
        "position:",
        "  phase: null",
        "  phase_name: null",
        "  plan: null",
        "  plan_name: null",
        "  task: null",
        "  task_name: null",
        "  status: idle",
        "progress:",
        "  phases_total: 0",
        "  phases_completed: 0",
        "  plans_total: 0",
        "  plans_completed: 0",
        "  tasks_total: 0",
        "  tasks_completed: 0",
        "current_plan:",
        "  path: null",
        "  tasks: []",
        "  completed_tasks: []",
        "  current_task_index: null",
        "",
      ].join("\n"),
    );
  }
  consola.info("Cache miss or fallback — cleared plan state");
}

export function setupGitExclude(cwd: string): void {
  const excludeDir = join(cwd, ".git/info");
  mkdirSync(excludeDir, { recursive: true });
  const excludePath = join(excludeDir, "exclude");

  const existingContent = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";

  const patterns = [".software-teams/", ".claude/"];
  const finalContent = patterns.reduce((acc, pattern) => {
    const lines = acc.split("\n");
    if (lines.some((line) => line === pattern)) return acc;
    const base = acc.endsWith("\n") || acc === "" ? acc : acc + "\n";
    return base + pattern + "\n";
  }, existingContent);

  writeFileSync(excludePath, finalContent);
}

export const bootstrapCommand = defineCommand({
  meta: {
    name: "bootstrap",
    description: "Bootstrap Software Teams framework, clear stale state, and configure git excludes",
  },
  args: {
    "cache-hit": {
      type: "string",
      description: "[DEPRECATED] Cache hit status. Kept for back-compat — prefer --matched-key.",
    },
    "matched-key": {
      type: "string",
      description:
        "Output of actions/cache@v4's `cache-matched-key`. Non-empty when the cache restored ANYTHING (primary or restore-keys prefix). We skip clearStaleState in that case so plan files persist across runs on the same issue/branch. The old --cache-hit approach was broken: actions/cache only sets cache-hit=true on EXACT primary-key match, but our save keys include `${run_id}` while restore primaries don't — so cache-hit was structurally always false, and the only reason it ever returned true was a stale legacy cache entry that fooled the system into preserving the WRONG plans.",
    },
  },
  run({ args }) {
    const cwd = process.cwd();

    ensureFramework(cwd);

    const matchedKey = args["matched-key"] ?? "";
    const cacheHit = args["cache-hit"] ?? "";
    const hasContinuity = matchedKey
      ? matchedKey.length > 0
      : cacheHit === "true";

    if (!hasContinuity) {
      clearStaleState(cwd);
    } else {
      consola.info(`Cache continuity detected (matched: ${matchedKey || cacheHit}) — preserving plan state`);
    }

    setupGitExclude(cwd);

    consola.success("Bootstrap complete");
  },
});
