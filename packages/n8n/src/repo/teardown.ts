import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { removeWorktree } from "./git.js";

// ── Result type ───────────────────────────────────────────────────────────────

export interface TeardownResult {
  readonly removed: boolean;
  readonly detail?: string;
}

// ── Path safety guard ─────────────────────────────────────────────────────────

/**
 * Assert that `targetPath` is strictly inside `basePath` after resolving both
 * to absolute canonical paths. Throws if the target IS the base, is above it,
 * or escapes via `..` traversal.
 *
 * Used by the rm-based helpers to prevent accidental deletion of the repo root,
 * `/`, or any path outside the allowed run base (R-04).
 */
export function assertWithinBase(targetPath: string, basePath: string): void {
  const absTarget = resolve(targetPath);
  const absBase = resolve(basePath);

  if (absTarget === absBase) {
    throw new Error(
      `Path safety violation: target "${absTarget}" is the base directory itself — refusing to delete.`,
    );
  }

  const rel = relative(absBase, absTarget);

  // relative() returns ".." or "../foo" when the target is outside the base,
  // or an absolute path when the paths are on different drives (Windows).
  if (rel.startsWith("..") || rel.startsWith(sep) || resolve(absBase, rel) !== absTarget) {
    throw new Error(
      `Path safety violation: target "${absTarget}" is outside base "${absBase}" — refusing to delete.`,
    );
  }
}

// ── teardownWorktree ──────────────────────────────────────────────────────────

/**
 * Idempotently remove a git worktree rooted at `worktreePath` inside
 * `repoRoot`. Delegates to the existing headless `removeWorktree` from
 * `src/repo/git.ts`. Returns `{ removed: false }` (never throws) when the
 * worktree path does not exist or git reports it is not a working tree.
 */
export async function teardownWorktree(
  repoRoot: string,
  worktreePath: string,
): Promise<TeardownResult> {
  if (!existsSync(worktreePath)) {
    return { removed: false, detail: "worktree path does not exist" };
  }

  try {
    await removeWorktree({ repoDir: repoRoot, worktreePath });
    return { removed: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Treat "not a working tree" / ENOENT as already-absent — idempotent.
    if (/not a working tree|ENOENT|is not a valid worktree|No such file/i.test(msg)) {
      return { removed: false, detail: msg };
    }
    // Genuine unexpected error — still do not throw (R-04 idempotency),
    // but surface it so callers can log.
    return { removed: false, detail: `unexpected error: ${msg}` };
  }
}

// ── teardownClone ─────────────────────────────────────────────────────────────

/**
 * Idempotently remove a clone directory at `clonePath`, guarded by
 * `assertWithinBase` against `runsBaseDir`. Skips silently if absent.
 */
export function teardownClone(
  clonePath: string,
  runsBaseDir: string,
): TeardownResult {
  assertWithinBase(clonePath, runsBaseDir);

  if (!existsSync(clonePath)) {
    return { removed: false, detail: "clone path does not exist" };
  }

  try {
    rmSync(clonePath, { recursive: true, force: true });
    return { removed: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|No such file/i.test(msg)) {
      return { removed: false, detail: msg };
    }
    return { removed: false, detail: `unexpected error: ${msg}` };
  }
}

// ── teardownAgentMemories ─────────────────────────────────────────────────────

/**
 * Remove per-run agent-memory files and directories whose name contains the
 * `correlationId` under `memoriesBase`. No-op if none match or the base does
 * not exist.
 */
export function teardownAgentMemories(
  correlationId: string,
  memoriesBase: string,
): TeardownResult {
  if (!correlationId) {
    return { removed: false, detail: "empty correlationId" };
  }

  if (!existsSync(memoriesBase)) {
    return { removed: false, detail: "memories base does not exist" };
  }

  let entries: string[];
  try {
    entries = readdirSync(memoriesBase);
  } catch {
    return { removed: false, detail: "could not read memories base directory" };
  }

  const matching = entries.filter((name) => name.includes(correlationId));
  if (matching.length === 0) {
    return { removed: false, detail: "no matching memory entries found" };
  }

  let removedCount = 0;
  for (const name of matching) {
    const fullPath = resolve(memoriesBase, name);
    try {
      rmSync(fullPath, { recursive: true, force: true });
      removedCount++;
    } catch {
      // best-effort per entry
    }
  }

  return {
    removed: removedCount > 0,
    detail: `removed ${removedCount}/${matching.length} memory entries`,
  };
}

// ── teardownPlanArtefacts ─────────────────────────────────────────────────────

/**
 * Remove run-scoped plan/task artefact files under `plansDir` whose name
 * encodes the `correlationId`. Never deletes the plans directory itself.
 * Also removes a per-run subdirectory named after the correlationId if present.
 */
export function teardownPlanArtefacts(
  correlationId: string,
  plansDir: string,
): TeardownResult {
  if (!correlationId) {
    return { removed: false, detail: "empty correlationId" };
  }

  assertWithinBase(resolve(plansDir, correlationId), plansDir);

  if (!existsSync(plansDir)) {
    return { removed: false, detail: "plans directory does not exist" };
  }

  let entries: string[];
  try {
    entries = readdirSync(plansDir);
  } catch {
    return { removed: false, detail: "could not read plans directory" };
  }

  const matching = entries.filter((name) => name.includes(correlationId));
  if (matching.length === 0) {
    return { removed: false, detail: "no matching plan artefacts found" };
  }

  let removedCount = 0;
  for (const name of matching) {
    const fullPath = resolve(plansDir, name);
    // Extra safety: never delete the plans dir itself
    if (resolve(fullPath) === resolve(plansDir)) continue;

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        rmSync(fullPath, { recursive: true, force: true });
      } else {
        rmSync(fullPath, { force: true });
      }
      removedCount++;
    } catch {
      // best-effort per entry
    }
  }

  return {
    removed: removedCount > 0,
    detail: `removed ${removedCount}/${matching.length} plan artefacts`,
  };
}
