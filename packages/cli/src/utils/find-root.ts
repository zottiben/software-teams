import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Walk up from `startDir` looking for a directory that contains a
 * Software Teams state file (`.software-teams/state.yaml`; legacy installs
 * may have it at `.software-teams/config/state.yaml`). Returns the absolute
 * path of that directory.
 *
 * Throws a descriptive error if no such directory is found before reaching
 * the filesystem root.
 */
export function findProjectRoot(startDir: string): string {
  const root = findProjectRootOrNull(startDir);
  if (root == null) {
    throw new Error(
      `No Software Teams project found (searched from ${startDir} upward for .software-teams/state.yaml). Run \`software-teams init\` to set one up.`,
    );
  }
  return root;
}

/**
 * Non-throwing variant of {@link findProjectRoot}. Returns `null` when no Software Teams
 * project root can be located from `startDir` upward.
 */
export function findProjectRootOrNull(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    // Current install layout.
    if (existsSync(join(current, ".software-teams", "state.yaml"))) {
      return current;
    }
    // Legacy install layout (pre-rebrand).
    if (existsSync(join(current, ".software-teams", "config", "state.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
