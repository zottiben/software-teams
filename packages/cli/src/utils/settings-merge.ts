import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HookEntry = {
  type: "command";
  command: string;
};

type PreToolUseHook = {
  matcher: string;
  hooks: HookEntry[];
};

/**
 * Minimal shape of `.claude/settings.json`. Unknown top-level keys (e.g.
 * `allowedTools`, `model`) are preserved by all functions.
 */
export type Settings = {
  hooks?: {
    PreToolUse?: PreToolUseHook[];
    [event: string]: PreToolUseHook[] | undefined;
  };
  [key: string]: unknown;
};

/** Describes a single hook addition or removal. */
export type HookSpec = {
  /** The hook event name, e.g. `"PreToolUse"`. */
  event: string;
  /** The tool matcher string, e.g. `"Edit|Write|NotebookEdit|Bash"`. */
  matcher: string;
  /** The shell command to invoke. */
  command: string;
};

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read `.claude/settings.json` from `path`.
 *
 * Returns `{}` (cold-start) when the file does not exist — this is the
 * expected state for a fresh project that has not been initialised yet.
 * Throws a descriptive error on JSON parse failures so the caller can
 * surface a useful message instead of a bare SyntaxError.
 *
 * @example
 * const settings = await readSettings(".claude/settings.json");
 */
export async function readSettings(path: string): Promise<Settings> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    return {};
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as Settings;
  } catch {
    throw new Error(
      `Failed to parse ${path}: the file contains invalid JSON. ` +
        `Fix or delete it and try again.`,
    );
  }
}

/**
 * Write `value` to `path` as pretty-printed JSON (2-space indent, trailing
 * newline). Creates the parent directory with `mkdir -p` semantics if it
 * does not already exist.
 *
 * @example
 * await writeSettings(".claude/settings.json", mergedSettings);
 */
export async function writeSettings(
  path: string,
  value: Settings,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Return a new Settings object that contains every hook entry described in
 * `additions`. Idempotent: if an entry with the same `event`, `matcher`, AND
 * `command` already exists it is not duplicated.
 *
 * The input object is never mutated — clone-on-write semantics apply to each
 * level of the hierarchy that is touched.
 *
 * @example
 * const next = mergeHooks(current, [
 *   {
 *     event: "PreToolUse",
 *     matcher: "Edit|Write|NotebookEdit|Bash",
 *     command: ".claude/hooks/orchestrator-deny-bash.sh",
 *   },
 * ]);
 */
export function mergeHooks(
  existing: Settings,
  additions: HookSpec[],
): Settings {
  return additions.reduce<Settings>((result, { event, matcher, command }) => {
    const hooks: NonNullable<Settings["hooks"]> = result.hooks ? { ...result.hooks } : {};
    const eventArray: PreToolUseHook[] = hooks[event] ? [...hooks[event]!] : [];
    hooks[event] = eventArray;

    const matcherIdx = eventArray.findIndex((h) => h.matcher === matcher);

    if (matcherIdx === -1) {
      eventArray.push({ matcher, hooks: [{ type: "command", command }] });
    } else {
      const matchingEntry = eventArray[matcherIdx]!;
      const hookEntries = [...matchingEntry.hooks];
      if (!hookEntries.some((e) => e.command === command)) {
        hookEntries.push({ type: "command", command });
      }
      eventArray[matcherIdx] = { ...matchingEntry, hooks: hookEntries };
    }

    return { ...result, hooks };
  }, { ...existing });
}

/**
 * Return a new Settings object with the specified hook entries removed.
 * Idempotent: if an entry is absent the function is a no-op for that entry.
 *
 * Cascading cleanup: after removing a HookEntry, if the parent
 * `PreToolUseHook.hooks` array is empty the whole `PreToolUseHook` is
 * dropped; if the event array becomes empty the key is deleted; if
 * `settings.hooks` becomes an empty object it is deleted entirely.
 *
 * The input object is never mutated.
 *
 * @example
 * const next = removeHooks(current, [
 *   {
 *     event: "PreToolUse",
 *     matcher: "Edit|Write|NotebookEdit|Bash",
 *     command: ".claude/hooks/orchestrator-deny-bash.sh",
 *   },
 * ]);
 */
export function removeHooks(
  existing: Settings,
  removals: HookSpec[],
): Settings {
  return removals.reduce<Settings>((result, { event, matcher, command }) => {
    if (!result.hooks?.[event]) return result;

    const eventArray = result.hooks[event]!;
    const matcherIdx = eventArray.findIndex((h) => h.matcher === matcher);
    if (matcherIdx === -1) return result;

    const matchingEntry = eventArray[matcherIdx]!;
    const filteredHookEntries = matchingEntry.hooks.filter((e) => e.command !== command);

    const newEventArray = filteredHookEntries.length === 0
      ? eventArray.filter((_, i) => i !== matcherIdx)
      : Object.assign([...eventArray], { [matcherIdx]: { ...matchingEntry, hooks: filteredHookEntries } });

    const newHooks: NonNullable<Settings["hooks"]> = { ...result.hooks };
    if (newEventArray.length === 0) {
      delete newHooks[event];
    } else {
      newHooks[event] = newEventArray;
    }

    if (Object.keys(newHooks).length === 0) {
      const { hooks: _hooks, ...rest } = result;
      return rest as Settings;
    }
    return { ...result, hooks: newHooks };
  }, { ...existing });
}
