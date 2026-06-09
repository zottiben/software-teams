import { defineCommand } from "citty";
import { consola } from "consola";
import { join, basename } from "node:path";
import { existsSync, readdirSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { fetchPrLinkedIssues } from "../../utils/github";
import { readState, writeState } from "../../utils/state";

function writeGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface PlanFrontmatter {
  issue?: number;
  repo?: string;
  [key: string]: unknown;
}

/**
 * Parse YAML frontmatter from a plan markdown file. Returns null when the file
 * has no leading `---` block (older plans created before tagging was added).
 */
export function parsePlanFrontmatter(content: string): PlanFrontmatter | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  try {
    return (parseYaml(match[1]) ?? {}) as PlanFrontmatter;
  } catch {
    return null;
  }
}

/**
 * Walk `.software-teams/plans/` and return every plan file whose frontmatter
 * `issue:` field matches one of the supplied numbers. Returns absolute paths.
 */
export function findPlansForIssues(
  plansDir: string,
  issueNumbers: number[],
): string[] {
  if (!existsSync(plansDir) || issueNumbers.length === 0) return [];
  const wanted = new Set(issueNumbers);
  const matches: string[] = [];
  for (const entry of readdirSync(plansDir)) {
    if (!entry.endsWith(".plan.md")) continue;
    const full = join(plansDir, entry);
    const fm = parsePlanFrontmatter(readFileSync(full, "utf8"));
    if (!fm) continue;
    const issue = typeof fm.issue === "number" ? fm.issue : Number(fm.issue);
    if (Number.isFinite(issue) && wanted.has(issue)) {
      matches.push(full);
    }
  }
  return matches;
}

/**
 * Derive the slug-prefix used for a plan's task files from the plan filename.
 * `foo-bar.plan.md` -> `foo-bar` (so `foo-bar.T1.md`, `foo-bar.T2.md` are
 * the task-file siblings).
 */
function planSlug(planPath: string): string {
  return basename(planPath).replace(/\.plan\.md$/, "");
}

/**
 * Delete a plan file plus its sibling `.T{n}.md` task files.
 */
export function deletePlanAndTasks(plansDir: string, planPath: string): string[] {
  const removed: string[] = [];
  const slug = planSlug(planPath);
  rmSync(planPath, { force: true });
  removed.push(planPath);
  for (const entry of readdirSync(plansDir)) {
    if (entry.startsWith(`${slug}.T`) && entry.endsWith(".md")) {
      const full = join(plansDir, entry);
      rmSync(full, { force: true });
      removed.push(full);
    }
  }
  return removed;
}

/**
 * If state.yaml's `current_plan.path` references a now-deleted plan, clear it
 * so future runs don't try to resume a phantom plan.
 */
async function clearOrphanedActivePlan(cwd: string, removed: string[]): Promise<boolean> {
  if (removed.length === 0) return false;
  const state = await readState(cwd);
  if (!state?.current_plan?.path) return false;
  const activeName = basename(state.current_plan.path);
  if (removed.some((p) => basename(p) === activeName)) {
    state.current_plan = {
      path: null,
      tasks: [],
      completed_tasks: [],
      current_task_index: null,
    };
    await writeState(cwd, state);
    return true;
  }
  return false;
}

export interface PrunePlansOptions {
  cwd: string;
  repo?: string;
  issueNumbers: number[];
  prNumber?: number;
}

/**
 * Core pruning logic, exposed for testing. Returns the list of files deleted.
 */
export async function prunePlans(opts: PrunePlansOptions): Promise<{
  resolvedIssues: number[];
  removed: string[];
  stateCleared: boolean;
}> {
  const resolved = new Set<number>(opts.issueNumbers.filter((n) => Number.isFinite(n) && n > 0));

  if (opts.prNumber && opts.repo) {
    const linked = await fetchPrLinkedIssues(opts.repo, opts.prNumber);
    for (const n of linked) resolved.add(n);
  }

  const issueNumbers = [...resolved];
  if (issueNumbers.length === 0) {
    return { resolvedIssues: [], removed: [], stateCleared: false };
  }

  const plansDir = join(opts.cwd, ".software-teams", "plans");
  const planFiles = findPlansForIssues(plansDir, issueNumbers);

  const removed: string[] = [];
  for (const planPath of planFiles) {
    removed.push(...deletePlanAndTasks(plansDir, planPath));
  }

  const stateCleared = await clearOrphanedActivePlan(opts.cwd, removed);
  return { resolvedIssues: issueNumbers, removed, stateCleared };
}

export const prunePlansCommand = defineCommand({
  meta: {
    name: "prune-plans",
    description:
      "Remove plan files tagged with the supplied issue numbers (or, with --pr-number, the issues that PR closes). Runs in `promote-rules` after a PR merges so stale plans don't bleed into the main baseline cache.",
  },
  args: {
    repo: {
      type: "string",
      description: "Repository in owner/repo format (required with --pr-number)",
    },
    "pr-number": {
      type: "string",
      description: "Look up `closingIssuesReferences` from this PR and prune plans for those issues",
    },
    "issue-number": {
      type: "string",
      description: "Comma-separated issue numbers to prune directly (in addition to PR-derived ones)",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const explicit = (args["issue-number"] ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const prNumber = args["pr-number"] ? Number(args["pr-number"]) : undefined;

    if (explicit.length === 0 && !prNumber) {
      consola.info("prune-plans: neither --issue-number nor --pr-number supplied — nothing to do");
      return;
    }
    if (prNumber && !args.repo) {
      consola.error("prune-plans: --repo is required when --pr-number is supplied");
      process.exit(1);
    }

    const result = await prunePlans({
      cwd,
      repo: args.repo,
      issueNumbers: explicit,
      prNumber,
    });

    const pruned = result.removed.length > 0;
    writeGitHubOutput("pruned", String(pruned));
    writeGitHubOutput("removed_count", String(result.removed.length));

    if (result.resolvedIssues.length === 0) {
      consola.info("prune-plans: no closing issues resolved — nothing to prune");
      return;
    }
    if (!pruned) {
      consola.info(
        `prune-plans: no plan files tagged with issue(s) ${result.resolvedIssues.join(", ")} — nothing to prune`,
      );
      return;
    }
    consola.success(
      `prune-plans: removed ${result.removed.length} file(s) for issue(s) ${result.resolvedIssues.join(", ")}`,
    );
    for (const path of result.removed) consola.info(`  - ${path}`);
    if (result.stateCleared) {
      consola.info("prune-plans: cleared current_plan in state.yaml (it pointed to a removed plan)");
    }
  },
});
