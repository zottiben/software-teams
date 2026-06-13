import { join, resolve, relative, basename, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { SoftwareTeamsStorage } from "../storage/interface";
import type { ConflictMode, ConvertAgentsResult } from "./convert-agents/conflict";
import { shouldWriteUnderConflict, writeIfChanged } from "./convert-agents/conflict";
import { parseAgentFile, validateAgentFrontmatter } from "./convert-agents/frontmatter";
import type { AgentFrontmatter } from "./convert-agents/frontmatter";
import { renderAgentOutput } from "./convert-agents/render";
import type { CatalogueEntry } from "./convert-agents/render";
import {
  resolveAgainst,
  resolveDefaultSourceDir,
  resolveDefaultRulesSource,
  writeCatalogue,
  writeRules,
} from "./convert-agents/io";

export type { ConflictMode };
export { AUTO_GENERATED_PREFIX } from "./convert-agents/conflict";
export type { ConvertAgentsResult };
export { validateAgentFrontmatter } from "./convert-agents/frontmatter";
export type { AgentFrontmatter } from "./convert-agents/frontmatter";

export interface ConvertAgentsOptions {
  sourceDir?: string;
  targetDir?: string;
  cwd?: string;
  dryRun?: boolean;
  onConflict?: ConflictMode;
  storage?: SoftwareTeamsStorage;
  models?: Record<string, string>;
}

export async function convertAgents(
  opts: ConvertAgentsOptions = {},
): Promise<ConvertAgentsResult> {
  const cwd = opts.cwd ?? process.cwd();
  const sourceDir = resolve(opts.sourceDir ? resolveAgainst(cwd, opts.sourceDir) : resolveDefaultSourceDir(cwd));
  const targetDir = resolve(opts.targetDir ? resolveAgainst(cwd, opts.targetDir) : join(cwd, ".claude", "agents"));
  const onConflict: ConflictMode = opts.onConflict ?? "overwrite";
  const dryRun = opts.dryRun === true;

  const result: ConvertAgentsResult = { written: [], unchanged: [], skipped: [], errors: [] };

  if (!existsSync(sourceDir)) {
    result.errors.push({
      file: sourceDir,
      reason: `source directory not found: ${sourceDir}`,
    });
    return result;
  }

  const glob = new Bun.Glob("software-teams-*.md");
  const sourceFiles: string[] = [];
  for await (const file of glob.scan({ cwd: sourceDir })) {
    sourceFiles.push(file);
  }
  // Deterministic ordering for stable logs.
  sourceFiles.sort();

  if (!dryRun && !existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const catalogueEntries: CatalogueEntry[] = [];

  for (const file of sourceFiles) {
    const sourcePath = join(sourceDir, file);
    try {
      const content = await Bun.file(sourcePath).text();
      const parsed = parseAgentFile(content, sourcePath);
      validateAgentFrontmatter(parsed.frontmatter, sourcePath);

      const fm = parsed.frontmatter as AgentFrontmatter;
      const key = fm.name.replace(/^software-teams-/, "");
      fm.model = opts.models?.[key] ?? fm.model;
      const outName = `${fm.name}.md`;
      const outPath = join(targetDir, outName);

      // Use the relative-from-cwd source path in the footer so output is
      // portable across machines and idempotent.
      const relSource = relative(cwd, sourcePath) || basename(sourcePath);
      const rendered = renderAgentOutput(parsed, relSource);

      if (!shouldWriteUnderConflict(outPath, onConflict, result)) {
        // Still include in the catalogue — the file represents a
        // registered agent even when this run skipped writing it.
        catalogueEntries.push({
          name: fm.name,
          model: fm.model,
          description: fm.description,
        });
        continue;
      }

      if (!dryRun) {
        const dir = dirname(outPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (await writeIfChanged(outPath, rendered)) {
          result.written.push(outPath);
        } else {
          result.unchanged.push(outPath);
        }
      } else {
        result.written.push(outPath);
      }
      catalogueEntries.push({
        name: fm.name,
        model: fm.model,
        description: fm.description,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: sourcePath, reason });
    }
  }

  // Emit the catalogue and rules document alongside the per-agent files.
  // `targetRoot` defaults to the parent of `targetDir` (i.e. `.claude/`).
  const targetRoot = dirname(targetDir);
  const rulesSource = resolveDefaultRulesSource(cwd);

  if (catalogueEntries.length > 0) {
    await writeCatalogue(catalogueEntries, targetRoot, onConflict, dryRun, result);
  }
  await writeRules(targetRoot, rulesSource, onConflict, dryRun, result);

  return result;
}
