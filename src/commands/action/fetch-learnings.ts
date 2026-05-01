import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Phase D: `.software-teams/rules/` holds BOTH learnings (which round-trip
 * through the external GitHub learnings repo) and non-learning rules
 * (`commits.md`, `deviations.md`) that stay local. Operations that move
 * data between the consumer and the external repo MUST filter to this
 * allowlist so the rules-rules never leak into the shared learnings repo.
 */
export const LEARNING_CATEGORIES = [
  "general",
  "backend",
  "frontend",
  "testing",
  "devops",
] as const;

const LEARNING_FILE_SET = new Set(
  LEARNING_CATEGORIES.map((c) => `${c}.md`),
);

export function isLearningFile(filename: string): boolean {
  return LEARNING_FILE_SET.has(filename);
}

/**
 * The path inside the external learnings repo where Software Teams stores
 * round-tripped learnings. Renamed from `jdi/learnings/` for brand
 * consistency with the rest of the framework.
 */
export const EXTERNAL_LEARNINGS_PATH = "software-teams/rules";

/**
 * Legacy path inside the external learnings repo. Read-supported as a
 * back-compat fallback for repos that haven't migrated yet; writes always
 * go to EXTERNAL_LEARNINGS_PATH.
 */
export const EXTERNAL_LEARNINGS_PATH_LEGACY = "jdi/learnings";

/**
 * Sparse-clone the external learnings repo's rules directory. Pulls both
 * the new path (software-teams/rules/) and the legacy path
 * (jdi/learnings/) so reads can fall back to legacy data while new writes
 * land in the new path.
 *
 * Returns the resolved path inside the clone whose directory actually
 * exists (preferring the new path), or null when neither is present.
 */
export function cloneLearningsRepo(
  repo: string,
  token: string,
  tmpDir: string,
): string | null {
  const cloneUrl = `https://x-access-token:${token}@github.com/${repo}.git`;

  const cloneResult = Bun.spawnSync(
    ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", cloneUrl, tmpDir],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (cloneResult.exitCode !== 0) {
    consola.warn("Could not clone learnings repo — continuing without shared learnings");
    return null;
  }

  // Sparse-checkout both new and legacy paths; whichever exists is what we read from.
  Bun.spawnSync(
    ["git", "sparse-checkout", "set", EXTERNAL_LEARNINGS_PATH, EXTERNAL_LEARNINGS_PATH_LEGACY],
    {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const newPath = join(tmpDir, EXTERNAL_LEARNINGS_PATH);
  const legacyPath = join(tmpDir, EXTERNAL_LEARNINGS_PATH_LEGACY);
  if (existsSync(newPath)) return newPath;
  if (existsSync(legacyPath)) {
    consola.info(
      `Reading learnings from legacy path (${EXTERNAL_LEARNINGS_PATH_LEGACY}); next write will land at ${EXTERNAL_LEARNINGS_PATH}.`,
    );
    return legacyPath;
  }
  return null;
}

/**
 * Merge learnings from source directory into target directory.
 * - New files are copied directly.
 * - Existing files get non-duplicate lines appended.
 * Returns counts of copied and merged files.
 *
 * Phase D: only files matching LEARNING_CATEGORIES are considered.
 * `.software-teams/rules/{commits,deviations}.md` (non-learning rules) are
 * kept local and must never round-trip through the shared learnings repo.
 */
export function mergeLearnings(
  sourceDir: string,
  targetDir: string,
): { copied: number; merged: number } {
  const result = { copied: 0, merged: 0 };

  if (!existsSync(sourceDir)) {
    return result;
  }

  mkdirSync(targetDir, { recursive: true });

  const files = readdirSync(sourceDir).filter((f) => isLearningFile(f));
  for (const file of files) {
    const sourcePath = join(sourceDir, file);
    const targetPath = join(targetDir, file);

    if (!existsSync(targetPath)) {
      // New file — copy directly
      copyFileSync(sourcePath, targetPath);
      result.copied++;
      consola.info(`Loaded shared learning: ${file}`);
    } else {
      // Existing file — append non-duplicate lines
      const sourceContent = readFileSync(sourcePath, "utf-8");
      const targetContent = readFileSync(targetPath, "utf-8");
      const targetLines = new Set(targetContent.split("\n"));

      const newLines: string[] = [];
      for (const line of sourceContent.split("\n")) {
        if (line.trim() === "") continue;
        if (!targetLines.has(line)) {
          newLines.push(line);
        }
      }

      if (newLines.length > 0) {
        const appendContent = (targetContent.endsWith("\n") ? "" : "\n") + newLines.join("\n") + "\n";
        writeFileSync(targetPath, targetContent + appendContent);
        result.merged++;
        consola.info(`Merged ${newLines.length} new lines into ${file}`);
      } else {
        consola.info(`No new learnings to merge for ${file}`);
      }
    }
  }

  return result;
}

export const fetchLearningsCommand = defineCommand({
  meta: {
    name: "fetch-learnings",
    description: "Fetch and merge shared learnings from an external repository",
  },
  args: {
    "learnings-repo": {
      type: "string",
      description: "External learnings repository (e.g. org/software-teams-learnings)",
    },
    "learnings-token": {
      type: "string",
      description: "Token for accessing the learnings repo",
    },
  },
  run({ args }) {
    const learningsRepo = args["learnings-repo"];
    if (!learningsRepo) {
      consola.info("No learnings repo configured — skipping");
      return;
    }

    const token = args["learnings-token"] || process.env.LEARNINGS_TOKEN || process.env.GH_TOKEN || "";
    if (!token) {
      consola.warn("No token available for learnings repo — skipping");
      return;
    }

    const cwd = process.cwd();
    const learningsDir = join(cwd, ".software-teams/rules");
    mkdirSync(learningsDir, { recursive: true });

    const tmpDir = mkdtempSync(join(tmpdir(), "st-learnings-"));

    try {
      const sourceDir = cloneLearningsRepo(learningsRepo, token, tmpDir);
      if (!sourceDir) {
        return;
      }

      const result = mergeLearnings(sourceDir, learningsDir);
      consola.success(`Learnings fetch complete (copied: ${result.copied}, merged: ${result.merged})`);
    } finally {
      // Always clean up temp dir
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});
