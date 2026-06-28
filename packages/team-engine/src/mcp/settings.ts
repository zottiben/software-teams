import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TaskRouteHook {
  /** Absolute path to the bundled route hook (`dist/team-route-hook.mjs`). */
  readonly hookScript: string;
  /** Absolute path to the roster JSON the hook consults. */
  readonly rosterPath: string;
}

export interface PaneSettingsInput {
  /** Engine control server URL the Stop hook pings. */
  readonly controlUrl: string;
  /** This pane's token, baked into the hook so the server knows which pane idled. */
  readonly token: string;
  /** When set, also installs a PreToolUse(Task) hook routing spawns to live panes. */
  readonly taskRoute?: TaskRouteHook;
}

interface HookCommand {
  readonly type: 'command';
  readonly command: string;
}

interface HookEntry {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
}

/** A Claude Code settings document carrying the pane's hooks. */
export interface SettingsDocument {
  readonly hooks: {
    readonly Stop?: readonly HookEntry[];
    readonly PreToolUse?: readonly HookEntry[];
  };
}

/**
 * Build a `--settings` document for one pane. It always carries a Stop hook (idle
 * signal → control server) and, when `taskRoute` is given, a PreToolUse(Task) hook
 * that blocks spawning a teammate who is already a live pane. `--settings` MERGES
 * at launch, so this never clobbers the user's project `.claude/settings.json`.
 */
export function buildPaneSettings(input: PaneSettingsInput): SettingsDocument {
  const stopCommand = `curl -s -X POST -H 'x-st-token: ${input.token}' '${input.controlUrl}/idle' >/dev/null 2>&1 || true`;
  const stop: HookEntry = { hooks: [{ type: 'command', command: stopCommand }] };
  const preToolUse: readonly HookEntry[] = input.taskRoute
    ? [
        {
          matcher: 'Task',
          hooks: [
            {
              type: 'command',
              command: `node '${input.taskRoute.hookScript}' '${input.taskRoute.rosterPath}'`,
            },
          ],
        },
      ]
    : [];
  return {
    hooks: {
      Stop: [stop],
      ...(preToolUse.length ? { PreToolUse: preToolUse } : {}),
    },
  };
}

/** Write a pane's settings to `<dir>/<agent>.settings.json` and return its path. */
export function writePaneSettings(dir: string, agent: string, input: PaneSettingsInput): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${agent}.settings.json`);
  writeFileSync(path, `${JSON.stringify(buildPaneSettings(input), null, 2)}\n`);
  return path;
}
