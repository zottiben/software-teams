import { join, resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { ConflictMode, ConvertAgentsResult } from "./conflict";
import { shouldWriteUnderConflict, writeIfChanged } from "./conflict";
import { renderCatalogue, RULES_BANNER } from "./render";
import type { CatalogueEntry } from "./render";

export function resolveAgainst(cwd: string, p: string): string {
  return resolve(cwd, p);
}

export function resolveDefaultSourceDir(cwd: string): string {
  const selfHost = join(cwd, "agents");
  if (existsSync(selfHost)) return selfHost;
  const legacyMirror = join(cwd, ".software-teams", "framework", "agents");
  if (existsSync(legacyMirror)) return legacyMirror;
  // Package root resolution mirrors copy-framework.ts.
  // import.meta.dir is utils/convert-agents/ — go up 3 levels to reach packages/cli/src/..,
  // matching the original convert-agents.ts where import.meta.dir was utils/ (2 levels).
  const oneUp = join(import.meta.dir, "..", "..", "..");
  const twoUp = join(import.meta.dir, "..", "..", "..", "..");
  const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;
  return join(packageRoot, "agents");
}

export function resolveDefaultRulesSource(cwd: string): string {
  const selfHost = join(cwd, "templates", "RULES.md");
  if (existsSync(selfHost)) return selfHost;
  const legacyMirror = join(cwd, ".software-teams", "framework", "templates", "RULES.md");
  if (existsSync(legacyMirror)) return legacyMirror;
  const oneUp = join(import.meta.dir, "..", "..", "..");
  const twoUp = join(import.meta.dir, "..", "..", "..", "..");
  const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;
  return join(packageRoot, "templates", "RULES.md");
}

export async function writeCatalogue(
  entries: CatalogueEntry[],
  targetRoot: string,
  onConflict: ConflictMode,
  dryRun: boolean,
  result: ConvertAgentsResult,
): Promise<void> {
  const outPath = join(targetRoot, "AGENTS.md");
  const rendered = renderCatalogue(entries);

  if (!shouldWriteUnderConflict(outPath, onConflict, result)) return;

  if (!dryRun) {
    if (!existsSync(targetRoot)) mkdirSync(targetRoot, { recursive: true });
    if (await writeIfChanged(outPath, rendered)) {
      result.written.push(outPath);
    } else {
      result.unchanged.push(outPath);
    }
  } else {
    result.written.push(outPath);
  }
}

export async function writeRules(
  targetRoot: string,
  sourceRulesPath: string,
  onConflict: ConflictMode,
  dryRun: boolean,
  result: ConvertAgentsResult,
): Promise<void> {
  const outPath = join(targetRoot, "RULES.md");

  if (!existsSync(sourceRulesPath)) {
    result.errors.push({
      file: sourceRulesPath,
      reason: `RULES.md template not found: ${sourceRulesPath}`,
    });
    return;
  }

  const sourceContent = await Bun.file(sourceRulesPath).text();
  const trimmed = sourceContent.replace(/^\s+/, "").replace(/\s+$/, "");
  const rendered = `${RULES_BANNER}\n\n${trimmed}\n`;

  if (!shouldWriteUnderConflict(outPath, onConflict, result)) return;

  if (!dryRun) {
    if (!existsSync(targetRoot)) mkdirSync(targetRoot, { recursive: true });
    if (await writeIfChanged(outPath, rendered)) {
      result.written.push(outPath);
    } else {
      result.unchanged.push(outPath);
    }
  } else {
    result.written.push(outPath);
  }
}

export { dirname };
