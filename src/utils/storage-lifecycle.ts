import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { JediStorage } from "../storage";

/**
 * Load persisted state (learnings + codebase-index) from storage
 * and write to local files that agents can read.
 */
export async function loadPersistedState(
  cwd: string,
  storage: JediStorage,
): Promise<{ learningsPath: string | null; codebaseIndexPath: string | null }> {
  let learningsPath: string | null = null;
  let codebaseIndexPath: string | null = null;

  const learnings = await storage.load("learnings");
  if (learnings) {
    const dir = join(cwd, ".jdi", "framework", "learnings");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    learningsPath = join(dir, "_consolidated.md");
    await Bun.write(learningsPath, learnings);
  }

  const codebaseIndex = await storage.load("codebase-index");
  if (codebaseIndex) {
    const dir = join(cwd, ".jdi", "codebase");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    codebaseIndexPath = join(dir, "INDEX.md");
    await Bun.write(codebaseIndexPath, codebaseIndex);
  }

  return { learningsPath, codebaseIndexPath };
}

/**
 * Save updated state (learnings + codebase-index) back to storage
 * after agent execution.
 */
export async function savePersistedState(
  cwd: string,
  storage: JediStorage,
): Promise<{ learningsSaved: boolean; codebaseIndexSaved: boolean }> {
  let learningsSaved = false;
  let codebaseIndexSaved = false;

  // Merge all learning files into consolidated markdown
  const learningsDir = join(cwd, ".jdi", "framework", "learnings");
  if (existsSync(learningsDir)) {
    const merged = await mergeLearningFiles(learningsDir);
    if (merged) {
      await storage.save("learnings", merged);
      learningsSaved = true;
    }
  }

  // Save codebase index if it exists
  const indexPath = join(cwd, ".jdi", "codebase", "INDEX.md");
  if (existsSync(indexPath)) {
    const content = await Bun.file(indexPath).text();
    if (content.trim()) {
      await storage.save("codebase-index", content);
      codebaseIndexSaved = true;
    }
  }

  return { learningsSaved, codebaseIndexSaved };
}

async function mergeLearningFiles(dir: string): Promise<string | null> {
  const categories = ["general", "backend", "frontend", "testing", "devops"];
  const sections: string[] = [];

  for (const category of categories) {
    const filePath = join(dir, `${category}.md`);
    if (!existsSync(filePath)) continue;

    const content = await Bun.file(filePath).text();
    const trimmed = content.trim();

    // Skip empty files (just headers/comments)
    const lines = trimmed.split("\n").filter(
      (l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"),
    );
    if (lines.length === 0) continue;

    sections.push(trimmed);
  }

  // Also include _consolidated.md content if it has unique entries
  const consolidatedPath = join(dir, "_consolidated.md");
  if (existsSync(consolidatedPath)) {
    const content = await Bun.file(consolidatedPath).text();
    const trimmed = content.trim();
    if (trimmed && !sections.some((s) => s.includes(trimmed))) {
      sections.push(trimmed);
    }
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
}
