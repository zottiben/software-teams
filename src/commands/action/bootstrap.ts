import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Ensure the JDI framework is initialized.
 * If `.jdi/framework` is missing, run `bunx @benzotti/jdi@latest init --ci`.
 * Also ensures `.jdi/persistence/` exists.
 */
export function ensureFramework(cwd: string): void {
  const frameworkDir = join(cwd, ".jdi/framework");
  if (!existsSync(frameworkDir)) {
    consola.info("Framework not found — initializing...");
    const result = Bun.spawnSync(["bunx", "@benzotti/jdi@latest", "init", "--ci"], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      consola.error("Failed to initialize framework");
      process.exit(1);
    }
  }
  mkdirSync(join(cwd, ".jdi/persistence"), { recursive: true });
}

/**
 * Clear stale plan state from a previous branch.
 * Removes all files in `.jdi/plans/` and writes a fresh `state.yaml`.
 */
export function clearStaleState(cwd: string): void {
  const plansDir = join(cwd, ".jdi/plans");
  if (existsSync(plansDir)) {
    // Remove all files inside plans dir
    for (const entry of readdirSync(plansDir)) {
      rmSync(join(plansDir, entry), { recursive: true, force: true });
    }
  } else {
    mkdirSync(plansDir, { recursive: true });
  }

  const configDir = join(cwd, ".jdi/config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "state.yaml"),
    "active_plan: null\ncurrent_wave: null\nmode: null\n",
  );
  consola.info("Cache miss or fallback — cleared plan state");
}

/**
 * Ensure `.jdi/` and `.claude/` are in `.git/info/exclude` (idempotent).
 */
export function setupGitExclude(cwd: string): void {
  const excludeDir = join(cwd, ".git/info");
  mkdirSync(excludeDir, { recursive: true });
  const excludePath = join(excludeDir, "exclude");

  let content = "";
  if (existsSync(excludePath)) {
    content = readFileSync(excludePath, "utf-8");
  }

  const patterns = [".jdi/", ".claude/"];
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
    description: "Bootstrap JDI framework, clear stale state, and configure git excludes",
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
