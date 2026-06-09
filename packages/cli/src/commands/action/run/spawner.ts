import { consola } from "consola";
import { spawnClaude } from "../../../utils/claude";
import { ACTION_MODEL } from "./constants";

/**
 * Thin wrappers around spawnClaude that thread model: ACTION_MODEL on every
 * call site so the constant is never accidentally omitted.
 *
 * All three spawnClaude call sites in the action runner go through this
 * module: pre-plan discovery, the main router spawn, and the full-flow
 * implement spawn.
 */

export interface SpawnResult {
  exitCode: number;
  response: string;
}

/** Spawn Claude for the pre-plan discovery (Research Agent) pass. */
export async function spawnDiscovery(opts: {
  prompt: string;
  cwd: string;
}): Promise<SpawnResult> {
  return await spawnClaude(opts.prompt, {
    cwd: opts.cwd,
    permissionMode: "acceptEdits",
    model: ACTION_MODEL,
  });
}

/** Spawn Claude for the main router turn (plan / implement / quick / etc.). */
export async function spawnRouter(opts: {
  prompt: string;
  cwd: string;
  dryRun?: boolean;
}): Promise<SpawnResult> {
  return await spawnClaude(opts.prompt, {
    cwd: opts.cwd,
    permissionMode: "acceptEdits",
    allowedTools: opts.dryRun ? ["Read", "Glob", "Grep", "Bash"] : undefined,
    model: ACTION_MODEL,
  });
}

/** Spawn Claude for the full-flow implement step (runs after plan in do-flow). */
export async function spawnImplement(opts: {
  prompt: string;
  cwd: string;
}): Promise<SpawnResult> {
  return await spawnClaude(opts.prompt, {
    cwd: opts.cwd,
    permissionMode: "acceptEdits",
    model: ACTION_MODEL,
  });
}

// Convenience re-export so callers can log with consola alongside spawning.
export { consola };
