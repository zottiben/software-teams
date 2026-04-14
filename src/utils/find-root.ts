import { join, dirname, resolve } from "path";
import { existsSync } from "fs";

/**
 * Walk up from `startDir` looking for a directory that contains
 * `.jdi/config/state.yaml`. Returns the absolute path of that directory.
 *
 * Throws a descriptive error if no such directory is found before reaching
 * the filesystem root.
 */
export function findJdiRoot(startDir: string): string {
  const root = findJdiRootOrNull(startDir);
  if (root == null) {
    throw new Error(
      `No JDI project found (searched from ${startDir} upward for .jdi/config/state.yaml). Run \`jdi init\` to set one up.`,
    );
  }
  return root;
}

/**
 * Non-throwing variant of {@link findJdiRoot}. Returns `null` when no JDI
 * project root can be located from `startDir` upward.
 */
export function findJdiRootOrNull(startDir: string): string | null {
  let current = resolve(startDir);
  // Walk upward until we hit the filesystem root.
  // `dirname('/')` returns '/', so use that as the termination condition.
  while (true) {
    const candidate = join(current, ".jdi", "config", "state.yaml");
    if (existsSync(candidate)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
