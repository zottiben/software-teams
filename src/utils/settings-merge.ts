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
  // Start with a shallow clone of the top-level settings so we never mutate
  // the caller's object.
  let result: Settings = { ...existing };

  for (const addition of additions) {
    const { event, matcher, command } = addition;

    // Clone hooks object (or create it) so we don't mutate the parent.
    const hooks: NonNullable<Settings["hooks"]> = result.hooks
      ? { ...result.hooks }
      : {};
    result = { ...result, hooks };

    // Clone the event array (or create it).
    const eventArray: PreToolUseHook[] = hooks[event]
      ? [...hooks[event]!]
      : [];
    hooks[event] = eventArray;

    // Find an existing PreToolUseHook with the same matcher.
    const matcherIdx = eventArray.findIndex((h) => h.matcher === matcher);

    if (matcherIdx === -1) {
      // No existing entry for this matcher — push a new one.
      eventArray.push({
        matcher,
        hooks: [{ type: "command", command }],
      });
    } else {
      // Clone the matching PreToolUseHook so we don't mutate it.
      const existing = eventArray[matcherIdx]!;
      const hookEntries = [...existing.hooks];

      // Check for an existing identical HookEntry (idempotent).
      const alreadyPresent = hookEntries.some((e) => e.command === command);
      if (!alreadyPresent) {
        hookEntries.push({ type: "command", command });
      }

      eventArray[matcherIdx] = { ...existing, hooks: hookEntries };
    }
  }

  return result;
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
  let result: Settings = { ...existing };

  for (const removal of removals) {
    const { event, matcher, command } = removal;

    if (!result.hooks?.[event]) {
      // Event key absent — no-op.
      continue;
    }

    const eventArray = result.hooks[event]!;
    const matcherIdx = eventArray.findIndex((h) => h.matcher === matcher);

    if (matcherIdx === -1) {
      // Matcher absent — no-op.
      continue;
    }

    const matchingEntry = eventArray[matcherIdx]!;
    const filteredHookEntries = matchingEntry.hooks.filter(
      (e) => e.command !== command,
    );

    // Build the new event array.
    let newEventArray: PreToolUseHook[];
    if (filteredHookEntries.length === 0) {
      // Remove the whole PreToolUseHook.
      newEventArray = eventArray.filter((_, i) => i !== matcherIdx);
    } else {
      newEventArray = [...eventArray];
      newEventArray[matcherIdx] = {
        ...matchingEntry,
        hooks: filteredHookEntries,
      };
    }

    // Clone the hooks object.
    const newHooks: NonNullable<Settings["hooks"]> = { ...result.hooks };

    if (newEventArray.length === 0) {
      // Remove the event key entirely.
      delete newHooks[event];
    } else {
      newHooks[event] = newEventArray;
    }

    // If hooks is now empty, remove it from result.
    if (Object.keys(newHooks).length === 0) {
      const { hooks: _hooks, ...rest } = result;
      result = rest as Settings;
    } else {
      result = { ...result, hooks: newHooks };
    }
  }

  return result;
}
