import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Sparse-clone the `jdi/learnings/` directory from an external repo.
 * Returns true if the clone succeeded and the directory exists.
 */
export function cloneLearningsRepo(repo: string, token: string, tmpDir: string): boolean {
  const cloneUrl = `https://x-access-token:${token}@github.com/${repo}.git`;

  const cloneResult = Bun.spawnSync(
    ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", cloneUrl, tmpDir],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (cloneResult.exitCode !== 0) {
    consola.warn("Could not clone learnings repo — continuing without shared learnings");
    return false;
  }

  // Set sparse checkout to only fetch jdi/learnings/
  Bun.spawnSync(["git", "sparse-checkout", "set", "jdi/learnings"], {
    cwd: tmpDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  return existsSync(join(tmpDir, "jdi/learnings"));
}

/**
 * Merge learnings from source directory into target directory.
 * - New files are copied directly.
 * - Existing files get non-duplicate lines appended.
 * Returns counts of copied and merged files.
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

  const files = readdirSync(sourceDir).filter((f) => f.endsWith(".md"));
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
      const cloned = cloneLearningsRepo(learningsRepo, token, tmpDir);
      if (!cloned) {
        return;
      }

      const sourceDir = join(tmpDir, "jdi/learnings");
      const result = mergeLearnings(sourceDir, learningsDir);
      consola.success(`Learnings fetch complete (copied: ${result.copied}, merged: ${result.merged})`);
    } finally {
      // Always clean up temp dir
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});
