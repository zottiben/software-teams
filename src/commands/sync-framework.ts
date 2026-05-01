import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { detectProjectType } from "../utils/detect-project";
import { copyFrameworkFiles } from "../utils/copy-framework";
import { convertAgents } from "../utils/convert-agents";

/**
 * Files that live under `.software-teams/` but represent project state (not framework
 * snapshot). They MUST NOT be touched by `sync-framework`. These paths are
 * preserved by virtue of `copyFrameworkFiles()` writing only to
 * `.software-teams/framework/` and `.software-teams/config/adapter.yaml` — never to these.
 */
const PRESERVED_STATE_FILES = [
  ".software-teams/PROJECT.yaml",
  ".software-teams/REQUIREMENTS.yaml",
  ".software-teams/ROADMAP.yaml",
  ".software-teams/config/state.yaml",
] as const;

/**
 * Subdirectories shipped from the package root into a consumer's
 * `.software-teams/framework/<sub>/` install. Mirrors PACKAGE_SUBDIRS in
 * copy-framework.ts; kept in sync by hand for now.
 */
const PACKAGE_SUBDIRS = [
  "templates",
  "teams",
  "hooks",
  "stacks",
  "learnings",
  "rules",
  "agents",
  "commands",
  "config",
];

/**
 * Enumerate canonical package files (relative paths). The legacy `framework/`
 * wrapper directory was retired in Phase A; each subtree now lives at the
 * package root directly. Output paths are still keyed by subdir so the
 * destination layout under `.software-teams/framework/` remains consistent
 * (Phase B collapses that mirror).
 */
async function listFrameworkFiles(packageRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of PACKAGE_SUBDIRS) {
    const subDir = join(packageRoot, sub);
    if (!existsSync(subDir)) continue;
    const subGlob = new Bun.Glob("**/*");
    for await (const file of subGlob.scan({ cwd: subDir })) {
      out.push(`${sub}/${file}`);
    }
  }
  // Top-level doctrine file lives at the package root.
  if (existsSync(join(packageRoot, "software-teams.md"))) {
    out.push("software-teams.md");
  }
  out.sort();
  return out;
}

/**
 * Compare canonical package-side content against `.software-teams/framework/<file>`
 * and return the relative paths that differ.
 */
export async function detectFrameworkChanges(
  cwd: string,
  packageRoot: string,
): Promise<{ missing: string[]; changed: string[] }> {
  const missing: string[] = [];
  const changed: string[] = [];
  const files = await listFrameworkFiles(packageRoot);
  for (const file of files) {
    const dest = join(cwd, ".software-teams", "framework", file);
    if (!existsSync(dest)) {
      missing.push(file);
      continue;
    }
    const srcContent = await Bun.file(join(packageRoot, file)).text();
    const destContent = await Bun.file(dest).text();
    if (srcContent !== destContent) changed.push(file);
  }
  return { missing, changed };
}

export const syncFrameworkCommand = defineCommand({
  meta: {
    name: "sync-framework",
    description:
      "Refresh the .software-teams/framework/ snapshot from canonical framework/ and re-sync .claude/agents/",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Preview which framework files would be refreshed without writing",
      default: false,
    },
    force: {
      type: "boolean",
      description:
        "Overwrite without prompting for diffs (useful in CI). Default behaviour also overwrites — kept for parity with `init`.",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const dryRun = args["dry-run"] === true;

    // Resolve the package root the same way copyFrameworkFiles does (two
    // levels above this file). The legacy `framework/` wrapper was retired in
    // Phase A; subtrees (templates, hooks, etc.) now live directly at the
    // package root.
    const packageRoot = join(import.meta.dir, "..", "..");
    if (!existsSync(join(packageRoot, "templates"))) {
      consola.error(
        `Software Teams package layout not found at ${packageRoot}. Are you running from inside the Software Teams package?`,
      );
      process.exit(1);
    }

    consola.start(
      `Refreshing .software-teams/framework/ from ${packageRoot}${dryRun ? " (dry-run)" : ""}`,
    );

    const { missing, changed } = await detectFrameworkChanges(cwd, packageRoot);
    const totalDelta = missing.length + changed.length;

    if (totalDelta === 0) {
      consola.success(".software-teams/framework/ is already up to date — no changes needed.");
      // Still re-sync agents for safety (idempotent).
      if (!dryRun) {
        const conv = await convertAgents({ cwd });
        consola.info(`Re-synced ${conv.written.length} agents to .claude/agents/`);
      }
      return;
    }

    if (missing.length > 0) {
      consola.info(`${missing.length} missing file(s) in snapshot:`);
      for (const f of missing.slice(0, 20)) consola.info(`  + ${f}`);
      if (missing.length > 20) consola.info(`  … and ${missing.length - 20} more`);
    }
    if (changed.length > 0) {
      consola.info(`${changed.length} drifted file(s):`);
      for (const f of changed.slice(0, 20)) consola.info(`  ~ ${f}`);
      if (changed.length > 20) consola.info(`  … and ${changed.length - 20} more`);
    }

    if (dryRun) {
      consola.info("Dry-run complete — no files written.");
      return;
    }

    // Reuse the canonical writer. force=true ensures all drifted files are
    // overwritten. Project state (PROJECT.yaml, REQUIREMENTS.yaml,
    // ROADMAP.yaml, config/state.yaml) is preserved because
    // copyFrameworkFiles() never writes to those paths.
    const projectType = await detectProjectType(cwd);
    await copyFrameworkFiles(cwd, projectType, true, false, packageRoot);
    consola.success(`Refreshed .software-teams/framework/ (${totalDelta} files updated).`);

    // Verify state files were preserved (sanity log only — the writer cannot
    // touch these paths, but log it so operators are reassured).
    for (const rel of PRESERVED_STATE_FILES) {
      const p = join(cwd, rel);
      if (existsSync(p)) {
        consola.info(`Preserved: ${rel}`);
      }
    }

    // Auto-rerun agent conversion so .claude/agents/ matches the refreshed
    // snapshot. One refresh = both layers synced.
    const conv = await convertAgents({ cwd });
    consola.success(
      `Re-synced ${conv.written.length} agent(s) to .claude/agents/${conv.errors.length > 0 ? ` (${conv.errors.length} error(s))` : ""}`,
    );
    if (conv.errors.length > 0) {
      for (const err of conv.errors) {
        consola.error(`${err.file}: ${err.reason}`);
      }
      process.exit(1);
    }
  },
});
