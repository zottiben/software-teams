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
 * Enumerate canonical `framework/` files (relative paths) excluding the
 * `adapters/` subtree, mirroring the filter applied by
 * `copyFrameworkFiles()`. Used for dry-run reporting and as the source list
 * for change detection.
 */
async function listFrameworkFiles(frameworkDir: string): Promise<string[]> {
  const out: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const file of glob.scan({ cwd: frameworkDir })) {
    if (file.startsWith("adapters/")) continue;
    out.push(file);
  }
  // Plugin tree (agents/+commands/) lives at the package root, not under
  // framework/. Surface its contents under the same logical paths so
  // detectFrameworkChanges and copyFrameworkFiles agree on what's canonical.
  const packageRoot = join(frameworkDir, "..");
  for (const sub of ["agents", "commands"]) {
    const subDir = join(packageRoot, sub);
    if (!existsSync(subDir)) continue;
    const subGlob = new Bun.Glob("*.md");
    for await (const file of subGlob.scan({ cwd: subDir })) {
      out.push(`${sub}/${file}`);
    }
  }
  out.sort();
  return out;
}

/**
 * Compare canonical `framework/<file>` against `.software-teams/framework/<file>` and
 * return the relative paths that differ (missing destination, or differing
 * size/mtime). Used for both `--dry-run` reporting and for the orchestration
 * test surface.
 */
export async function detectFrameworkChanges(
  cwd: string,
  frameworkDir: string,
): Promise<{ missing: string[]; changed: string[] }> {
  const missing: string[] = [];
  const changed: string[] = [];
  const files = await listFrameworkFiles(frameworkDir);
  const packageRoot = join(frameworkDir, "..");
  for (const file of files) {
    const dest = join(cwd, ".software-teams", "framework", file);
    if (!existsSync(dest)) {
      missing.push(file);
      continue;
    }
    // agents/* and commands/* sources live at the package root since the
    // plugin-tree promotion; everything else still under frameworkDir.
    const sourceRoot =
      file.startsWith("agents/") || file.startsWith("commands/")
        ? packageRoot
        : frameworkDir;
    const srcContent = await Bun.file(join(sourceRoot, file)).text();
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

    // Resolve canonical framework directory the same way copyFrameworkFiles
    // does (sibling of src/, i.e. the package root's `framework/`).
    const frameworkDir = join(import.meta.dir, "..", "..", "framework");
    if (!existsSync(frameworkDir)) {
      consola.error(
        `Canonical framework directory not found: ${frameworkDir}. Are you running from inside the Software Teams package?`,
      );
      process.exit(1);
    }

    consola.start(
      `Refreshing .software-teams/framework/ from ${frameworkDir}${dryRun ? " (dry-run)" : ""}`,
    );

    const { missing, changed } = await detectFrameworkChanges(cwd, frameworkDir);
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
    await copyFrameworkFiles(cwd, projectType, true, false, frameworkDir);
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
