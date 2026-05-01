import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import type { JdiStorage } from "../storage";

const RULE_CATEGORIES = ["general", "backend", "frontend", "testing", "devops"];

/**
 * Load persisted state (rules + codebase-index) from storage and write
 * to local files that agents can read.
 */
export async function loadPersistedState(
  cwd: string,
  storage: JdiStorage,
): Promise<{ rulesPath: string | null; codebaseIndexPath: string | null }> {
  let rulesPath: string | null = null;
  let codebaseIndexPath: string | null = null;

  // Load each rule category file individually
  const dir = join(cwd, ".software-teams", "rules");
  let anyLoaded = false;
  for (const category of RULE_CATEGORIES) {
    // Try the new key first, then fall back to the legacy `learnings-*` key
    // for caches written before the rename.
    const content =
      (await storage.load(`rules-${category}`)) ??
      (await storage.load(`learnings-${category}`));
    if (content) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, `${category}.md`), content);
      anyLoaded = true;
    }
  }

  if (anyLoaded) {
    rulesPath = dir;
  } else if (existsSync(dir)) {
    // Final fallback: rules already exist on disk (e.g. committed to repo).
    // This handles the case where cache has been evicted but rules were
    // persisted via git.
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) {
      rulesPath = dir;
    }
  }

  const codebaseIndex = await storage.load("codebase-index");
  if (codebaseIndex) {
    const cbDir = join(cwd, ".software-teams", "codebase");
    if (!existsSync(cbDir)) mkdirSync(cbDir, { recursive: true });
    codebaseIndexPath = join(cbDir, "INDEX.md");
    await Bun.write(codebaseIndexPath, codebaseIndex);
  }

  return { rulesPath, codebaseIndexPath };
}

/**
 * Save updated state (rules + codebase-index) back to storage after
 * agent execution.
 */
export async function savePersistedState(
  cwd: string,
  storage: JdiStorage,
): Promise<{ rulesSaved: boolean; codebaseIndexSaved: boolean }> {
  let rulesSaved = false;
  let codebaseIndexSaved = false;

  // Save each rule category file individually
  const rulesDir = join(cwd, ".software-teams", "rules");
  if (existsSync(rulesDir)) {
    for (const category of RULE_CATEGORIES) {
      const filePath = join(rulesDir, `${category}.md`);
      if (!existsSync(filePath)) continue;

      const content = await Bun.file(filePath).text();
      const trimmed = content.trim();

      // Skip empty files (just headers/comments)
      const lines = trimmed.split("\n").filter(
        (l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"),
      );
      if (lines.length === 0) continue;

      await storage.save(`rules-${category}`, trimmed);
      rulesSaved = true;
    }
  }

  // Save codebase index if it exists
  const indexPath = join(cwd, ".software-teams", "codebase", "INDEX.md");
  if (existsSync(indexPath)) {
    const content = await Bun.file(indexPath).text();
    if (content.trim()) {
      await storage.save("codebase-index", content);
      codebaseIndexSaved = true;
    }
  }

  return { rulesSaved, codebaseIndexSaved };
}
