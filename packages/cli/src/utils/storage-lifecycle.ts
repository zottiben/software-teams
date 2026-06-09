import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import type { SoftwareTeamsStorage } from "../storage";

const RULE_CATEGORIES = ["general", "backend", "frontend", "testing", "devops"];

/**
 * Write `content` to `path` only when the existing file's bytes differ.
 * Avoids stamping a fresh mtime on every `gatherPromptContext` call when
 * persisted state hasn't changed — keeps file-content caches valid and
 * keeps the prompt prefix byte-identical run-to-run.
 */
async function writeIfChanged(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    const existing = await Bun.file(path).text();
    if (existing === content) return;
  }
  await Bun.write(path, content);
}

/**
 * Load persisted state (rules + codebase-index) from storage and write
 * to local files that agents can read.
 */
export async function loadPersistedState(
  cwd: string,
  storage: SoftwareTeamsStorage,
): Promise<{ rulesPath: string | null; codebaseIndexPath: string | null }> {
  const dir = join(cwd, ".software-teams", "rules");
  const ruleLoadResults = await Promise.all(
    RULE_CATEGORIES.map(async (category) => {
      const content =
        (await storage.load(`rules-${category}`)) ??
        (await storage.load(`learnings-${category}`));
      if (content) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        await writeIfChanged(join(dir, `${category}.md`), content);
        return true;
      }
      return false;
    }),
  );
  const anyLoaded = ruleLoadResults.some(Boolean);

  const rulesPath: string | null = anyLoaded
    ? dir
    : existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith(".md")).length > 0
      ? dir
      : null;

  const codebaseIndex = await storage.load("codebase-index");
  const codebaseIndexPath: string | null = await (async () => {
    if (!codebaseIndex) return null;
    const cbDir = join(cwd, ".software-teams", "codebase");
    if (!existsSync(cbDir)) mkdirSync(cbDir, { recursive: true });
    const indexPath = join(cbDir, "INDEX.md");
    await writeIfChanged(indexPath, codebaseIndex);
    return indexPath;
  })();

  return { rulesPath, codebaseIndexPath };
}

/**
 * Save updated state (rules + codebase-index) back to storage after
 * agent execution.
 */
export async function savePersistedState(
  cwd: string,
  storage: SoftwareTeamsStorage,
): Promise<{ rulesSaved: boolean; codebaseIndexSaved: boolean }> {
  const rulesDir = join(cwd, ".software-teams", "rules");
  const ruleSaveResults = existsSync(rulesDir)
    ? await Promise.all(
        RULE_CATEGORIES.map(async (category) => {
          const filePath = join(rulesDir, `${category}.md`);
          if (!existsSync(filePath)) return false;
          const content = await Bun.file(filePath).text();
          const trimmed = content.trim();
          const hasContent = trimmed.split("\n").some(
            (l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"),
          );
          if (!hasContent) return false;
          await storage.save(`rules-${category}`, trimmed);
          return true;
        }),
      )
    : [];
  const rulesSaved = ruleSaveResults.some(Boolean);

  const indexPath = join(cwd, ".software-teams", "codebase", "INDEX.md");
  const codebaseIndexSaved = await (async () => {
    if (!existsSync(indexPath)) return false;
    const content = await Bun.file(indexPath).text();
    if (!content.trim()) return false;
    await storage.save("codebase-index", content);
    return true;
  })();

  return { rulesSaved, codebaseIndexSaved };
}
