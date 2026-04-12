import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { JdiStorage } from "../storage";

const LEARNINGS_CATEGORIES = ["general", "backend", "frontend", "testing", "devops"];

/**
 * Load persisted state (learnings + codebase-index) from storage
 * and write to local files that agents can read.
 */
export async function loadPersistedState(
  cwd: string,
  storage: JdiStorage,
): Promise<{ learningsPath: string | null; codebaseIndexPath: string | null }> {
  let learningsPath: string | null = null;
  let codebaseIndexPath: string | null = null;

  // Load each learnings category file individually
  const dir = join(cwd, ".jdi", "framework", "learnings");
  let anyLoaded = false;
  for (const category of LEARNINGS_CATEGORIES) {
    const content = await storage.load(`learnings-${category}`);
    if (content) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, `${category}.md`), content);
      anyLoaded = true;
    }
  }

  // Fallback: load legacy consolidated learnings if no category files found
  if (!anyLoaded) {
    const learnings = await storage.load("learnings");
    if (learnings) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const consolidatedPath = join(dir, "_consolidated.md");
      await Bun.write(consolidatedPath, learnings);
      learningsPath = consolidatedPath;
    }
  } else {
    learningsPath = dir;
  }

  // Final fallback: check if learnings already exist on disk (e.g. committed to repo).
  // This handles the case where cache has been evicted but learnings were persisted via git.
  if (!learningsPath && existsSync(dir)) {
    const { readdirSync } = await import("fs");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) {
      learningsPath = dir;
    }
  }

  const codebaseIndex = await storage.load("codebase-index");
  if (codebaseIndex) {
    const cbDir = join(cwd, ".jdi", "codebase");
    if (!existsSync(cbDir)) mkdirSync(cbDir, { recursive: true });
    codebaseIndexPath = join(cbDir, "INDEX.md");
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
  storage: JdiStorage,
): Promise<{ learningsSaved: boolean; codebaseIndexSaved: boolean }> {
  let learningsSaved = false;
  let codebaseIndexSaved = false;

  // Save each learnings category file individually
  const learningsDir = join(cwd, ".jdi", "framework", "learnings");
  if (existsSync(learningsDir)) {
    for (const category of LEARNINGS_CATEGORIES) {
      const filePath = join(learningsDir, `${category}.md`);
      if (!existsSync(filePath)) continue;

      const content = await Bun.file(filePath).text();
      const trimmed = content.trim();

      // Skip empty files (just headers/comments)
      const lines = trimmed.split("\n").filter(
        (l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"),
      );
      if (lines.length === 0) continue;

      await storage.save(`learnings-${category}`, trimmed);
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
