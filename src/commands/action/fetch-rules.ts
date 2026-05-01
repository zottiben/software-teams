import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * `.software-teams/rules/` holds BOTH shared rules (which round-trip through
 * the external GitHub rules repo) and project-only rules (`commits.md`,
 * `deviations.md`) that stay local. Operations that move data between the
 * consumer and the external repo MUST filter to this allowlist so the
 * project-only rules never leak into the shared repo.
 */
export const RULE_CATEGORIES = [
  "general",
  "backend",
  "frontend",
  "testing",
  "devops",
] as const;

const RULE_FILE_SET = new Set(
  RULE_CATEGORIES.map((c) => `${c}.md`),
);

export function isRuleFile(filename: string): boolean {
  return RULE_FILE_SET.has(filename);
}

/**
 * The path inside the external rules repo where Software Teams stores
 * round-tripped rules. Renamed from `jdi/learnings/` for brand consistency
 * with the rest of the framework.
 */
export const EXTERNAL_RULES_PATH = "software-teams/rules";

/**
 * Legacy path inside the external rules repo. Read-supported as a
 * back-compat fallback for repos that haven't migrated yet; writes always
 * go to EXTERNAL_RULES_PATH.
 */
export const EXTERNAL_RULES_PATH_LEGACY = "jdi/learnings";

/**
 * Sparse-clone the external rules repo's rules directory. Pulls both the
 * new path (software-teams/rules/) and the legacy path (jdi/learnings/) so
 * reads can fall back to legacy data while new writes land in the new path.
 *
 * Returns the resolved path inside the clone whose directory actually
 * exists (preferring the new path), or null when neither is present.
 */
export function cloneRulesRepo(
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
    consola.warn("Could not clone rules repo — continuing without shared rules");
    return null;
  }

  // Sparse-checkout both new and legacy paths; whichever exists is what we read from.
  Bun.spawnSync(
    ["git", "sparse-checkout", "set", EXTERNAL_RULES_PATH, EXTERNAL_RULES_PATH_LEGACY],
    {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const newPath = join(tmpDir, EXTERNAL_RULES_PATH);
  const legacyPath = join(tmpDir, EXTERNAL_RULES_PATH_LEGACY);
  if (existsSync(newPath)) return newPath;
  if (existsSync(legacyPath)) {
    consola.info(
      `Reading rules from legacy path (${EXTERNAL_RULES_PATH_LEGACY}); next write will land at ${EXTERNAL_RULES_PATH}.`,
    );
    return legacyPath;
  }
  return null;
}

/**
 * Normalise a rule line so equivalent prose with different formatting is
 * treated as the same rule. Lower-cases, strips list markers / leading
 * whitespace, and collapses runs of whitespace.
 */
function normaliseRuleLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a set of normalised lines that already appear in any project
 * CLAUDE.md file, so the rules feedback loop doesn't add guidance the
 * project already documents.
 *
 * Reads `.claude/CLAUDE.md` and `./CLAUDE.md` if present. Imports
 * (`@.claude/AGENTS.md` etc.) inside CLAUDE.md are NOT followed — only the
 * literal CLAUDE.md content counts.
 */
export function loadClaudeMdRuleSet(cwd: string): Set<string> {
  const set = new Set<string>();
  const candidates = [
    join(cwd, ".claude", "CLAUDE.md"),
    join(cwd, "CLAUDE.md"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
      const norm = normaliseRuleLine(trimmed);
      if (norm) set.add(norm);
    }
  }
  return set;
}

/**
 * Merge rules from source directory into target directory.
 * - New files are copied directly (after CLAUDE.md dedup if `cwd` provided).
 * - Existing files get non-duplicate lines appended.
 * Returns counts of copied and merged files.
 *
 * Only files matching RULE_CATEGORIES are considered.
 * `.software-teams/rules/{commits,deviations}.md` (project-only rules) are
 * kept local and must never round-trip through the shared rules repo.
 *
 * When `cwd` is provided, lines that already appear in the project's
 * CLAUDE.md files (.claude/CLAUDE.md or ./CLAUDE.md) are skipped — the
 * feedback loop should only add genuinely new guidance to the rules files.
 */
export function mergeRules(
  sourceDir: string,
  targetDir: string,
  cwd?: string,
): { copied: number; merged: number } {
  const result = { copied: 0, merged: 0 };

  if (!existsSync(sourceDir)) {
    return result;
  }

  mkdirSync(targetDir, { recursive: true });

  const claudeMdSet = cwd ? loadClaudeMdRuleSet(cwd) : new Set<string>();

  const files = readdirSync(sourceDir).filter((f) => isRuleFile(f));
  for (const file of files) {
    const sourcePath = join(sourceDir, file);
    const targetPath = join(targetDir, file);

    if (!existsSync(targetPath)) {
      // New file — filter through CLAUDE.md dedup before copying. If every
      // non-header / non-comment / non-blank line is already in CLAUDE.md,
      // drop the file entirely (don't write headers-only stubs).
      const sourceContent = readFileSync(sourcePath, "utf-8");
      const filtered = filterAgainstClaudeMd(sourceContent, claudeMdSet);
      if (!filtered.hasContent) {
        consola.info(`Skipped shared rule (already in CLAUDE.md): ${file}`);
        continue;
      }
      if (filtered.dropped > 0) {
        writeFileSync(targetPath, filtered.kept.join("\n") + "\n");
        consola.info(`Loaded shared rule: ${file} (skipped ${filtered.dropped} line(s) already in CLAUDE.md)`);
      } else {
        copyFileSync(sourcePath, targetPath);
        consola.info(`Loaded shared rule: ${file}`);
      }
      result.copied++;
    } else {
      // Existing file — append non-duplicate lines (vs existing target AND CLAUDE.md).
      const sourceContent = readFileSync(sourcePath, "utf-8");
      const targetContent = readFileSync(targetPath, "utf-8");
      const targetLines = new Set(targetContent.split("\n"));
      const targetNormSet = new Set(
        targetContent.split("\n").map(normaliseRuleLine).filter((s) => s),
      );

      const newLines: string[] = [];
      let droppedByClaudeMd = 0;
      for (const line of sourceContent.split("\n")) {
        if (line.trim() === "") continue;
        if (targetLines.has(line)) continue;
        const norm = normaliseRuleLine(line);
        if (norm && targetNormSet.has(norm)) continue;
        if (norm && claudeMdSet.has(norm)) {
          droppedByClaudeMd++;
          continue;
        }
        newLines.push(line);
      }

      if (newLines.length > 0) {
        const appendContent = (targetContent.endsWith("\n") ? "" : "\n") + newLines.join("\n") + "\n";
        writeFileSync(targetPath, targetContent + appendContent);
        result.merged++;
        const suffix = droppedByClaudeMd > 0 ? ` (skipped ${droppedByClaudeMd} already in CLAUDE.md)` : "";
        consola.info(`Merged ${newLines.length} new lines into ${file}${suffix}`);
      } else {
        consola.info(`No new rules to merge for ${file}`);
      }
    }
  }

  return result;
}

function filterAgainstClaudeMd(
  content: string,
  claudeMdSet: Set<string>,
): { kept: string[]; dropped: number; hasContent: boolean } {
  if (claudeMdSet.size === 0) {
    const lines = content.split("\n");
    const hasContent = lines.some((l) => {
      const t = l.trim();
      return t && !t.startsWith("#") && !t.startsWith("<!--");
    });
    return { kept: lines, dropped: 0, hasContent };
  }
  const kept: string[] = [];
  let dropped = 0;
  let hasContent = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("<!--")) {
      kept.push(line);
      continue;
    }
    const norm = normaliseRuleLine(trimmed);
    if (norm && claudeMdSet.has(norm)) {
      dropped++;
      continue;
    }
    kept.push(line);
    hasContent = true;
  }
  // Drop trailing blanks introduced by the filter
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  return { kept, dropped, hasContent };
}

export const fetchRulesCommand = defineCommand({
  meta: {
    name: "fetch-rules",
    description: "Fetch and merge shared rules from an external repository",
  },
  args: {
    "rules-repo": {
      type: "string",
      description: "External rules repository (e.g. org/software-teams-rules)",
    },
    "rules-token": {
      type: "string",
      description: "Token for accessing the rules repo",
    },
  },
  run({ args }) {
    const rulesRepo = args["rules-repo"];
    if (!rulesRepo) {
      consola.info("No rules repo configured — skipping");
      return;
    }

    const token = args["rules-token"] || process.env.RULES_TOKEN || process.env.LEARNINGS_TOKEN || process.env.GH_TOKEN || "";
    if (!token) {
      consola.warn("No token available for rules repo — skipping");
      return;
    }

    const cwd = process.cwd();
    const rulesDir = join(cwd, ".software-teams/rules");
    mkdirSync(rulesDir, { recursive: true });

    const tmpDir = mkdtempSync(join(tmpdir(), "st-rules-"));

    try {
      const sourceDir = cloneRulesRepo(rulesRepo, token, tmpDir);
      if (!sourceDir) {
        return;
      }

      const result = mergeRules(sourceDir, rulesDir, cwd);
      consola.success(`Rules fetch complete (copied: ${result.copied}, merged: ${result.merged})`);
    } finally {
      // Always clean up temp dir
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});
