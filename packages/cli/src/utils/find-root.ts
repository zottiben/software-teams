import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const isStateDir = (dir: string) =>
  existsSync(join(dir, ".software-teams", "state.yaml")) ||
  existsSync(join(dir, ".software-teams", "config", "state.yaml"));

function walkUp(dir: string): string | null {
  if (isStateDir(dir)) return dir;
  const parent = dirname(dir);
  return parent === dir ? null : walkUp(parent);
}

export function findProjectRoot(startDir: string): string {
  const root = findProjectRootOrNull(startDir);
  if (root == null) {
    throw new Error(
      `No Software Teams project found (searched from ${startDir} upward for .software-teams/state.yaml). Run \`software-teams init\` to set one up.`,
    );
  }
  return root;
}

export function findProjectRootOrNull(startDir: string): string | null {
  return walkUp(resolve(startDir));
}
