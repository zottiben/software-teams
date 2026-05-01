import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Ensure the Software Teams framework is initialized.
 * If `.software-teams/framework` is missing, run `bunx @benzotti/software-teams@latest init --ci`.
 * Also ensures `.software-teams/persistence/` exists.
 */
export function ensureFramework(cwd: string): void {
  const frameworkDir = join(cwd, ".software-teams/framework");
  if (!existsSync(frameworkDir)) {
    consola.info("Framework not found — initializing...");
    const result = Bun.spawnSync(["bunx", "@benzotti/software-teams@latest", "init", "--ci"], {
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

/**
 * Clear stale plan state from a previous branch.
 * Removes all files in `.software-teams/plans/` and writes a fresh `state.yaml`.
 */
export function clearStaleState(cwd: string): void {
  const plansDir = join(cwd, ".software-teams/plans");
  if (existsSync(plansDir)) {
    // Remove all files inside plans dir
    for (const entry of readdirSync(plansDir)) {
      rmSync(join(plansDir, entry), { recursive: true, force: true });
    }
  } else {
    mkdirSync(plansDir, { recursive: true });
  }

  const configDir = join(cwd, ".software-teams/config");
  mkdirSync(configDir, { recursive: true });
  // Copy the canonical state template from the framework
  const templatePath = join(cwd, ".software-teams", "framework", "config", "state.yaml");
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, "utf-8");
    writeFileSync(join(configDir, "state.yaml"), template);
  } else {
    // Minimal valid state matching the SoftwareTeamsState interface
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

/**
 * Ensure `.software-teams/` and `.claude/` are in `.git/info/exclude` (idempotent).
 */
export function setupGitExclude(cwd: string): void {
  const excludeDir = join(cwd, ".git/info");
  mkdirSync(excludeDir, { recursive: true });
  const excludePath = join(excludeDir, "exclude");

  let content = "";
  if (existsSync(excludePath)) {
    content = readFileSync(excludePath, "utf-8");
  }

  const patterns = [".software-teams/", ".claude/"];
  for (const pattern of patterns) {
    // Check for exact line match
    const lines = content.split("\n");
    if (!lines.some((line) => line === pattern)) {
      content = content.endsWith("\n") || content === "" ? content : content + "\n";
      content += pattern + "\n";
    }
  }

  writeFileSync(excludePath, content);
}

export const bootstrapCommand = defineCommand({
  meta: {
    name: "bootstrap",
    description: "Bootstrap Software Teams framework, clear stale state, and configure git excludes",
  },
  args: {
    "cache-hit": {
      type: "string",
      description: "Cache hit status from actions/cache ('true' if exact match)",
    },
  },
  run({ args }) {
    const cwd = process.cwd();

    ensureFramework(cwd);

    if (args["cache-hit"] !== "true") {
      clearStaleState(cwd);
    }

    setupGitExclude(cwd);

    consola.success("Bootstrap complete");
  },
});
