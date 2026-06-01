# CLI Invocation — Canonical Resolution Snippet

This is the **single source of truth** for invoking the Software Teams CLI from
any call site (skills in `commands/*.md`, agent docs in `agents/*.md`). It
resolves one token — **`$ST_CLI`** — that every downstream call site uses in
place of a bare `software-teams` binary call.

The bundled CLI is **Bun-native** — it uses `Bun.file`, `Bun.write`, and
`Bun.Glob`, and `dist/index.js` ships with a `#!/usr/bin/env bun` shebang. It
**cannot run under `node`**. Both distribution modes therefore resolve to a
**Bun** runtime:

- **Plugin mode** — installed as a Claude Code plugin from the git repo.
  `${CLAUDE_PLUGIN_ROOT}` is set and the bundled CLI ships at
  `${CLAUDE_PLUGIN_ROOT}/dist/index.js`, run via `bun`. There is NO global
  install.
- **Standalone / CLI mode** — the user ran a global install
  (`bun add -g @websitelabs/software-teams` or
  `npm i -g @websitelabs/software-teams`). `${CLAUDE_PLUGIN_ROOT}` is unset; a
  `software-teams` binary is on `PATH` (and its `#!/usr/bin/env bun` shebang
  still requires `bun` to be installed).

## The resolution snippet

Resolve `$ST_CLI` with the block below, then invoke the CLI as
`$ST_CLI <verb> <flags>` (e.g. `$ST_CLI init --state-only`,
`$ST_CLI state plan-ready`):

```bash
# Resolve the Software Teams CLI into $ST_CLI (prefer the bundled plugin dist
# run via bun, else a global install on PATH, else fail fast). The CLI is
# Bun-native and cannot run under node.
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/dist/index.js" ]; then
  # Plugin mode: run the bundled, Bun-native CLI. Requires bun.
  if command -v bun >/dev/null 2>&1; then
    ST_CLI="bun ${CLAUDE_PLUGIN_ROOT}/dist/index.js"
  else
    echo "Software Teams: the plugin bundle exists at \"${CLAUDE_PLUGIN_ROOT}/dist/index.js\" but 'bun' is not installed to run it (the CLI is Bun-native and cannot run under node)." >&2
    echo "Install bun (https://bun.sh), or install the CLI globally with one of:" >&2
    echo "  bun add -g @websitelabs/software-teams" >&2
    echo "  npm i -g @websitelabs/software-teams" >&2
    exit 1
  fi
elif command -v software-teams >/dev/null 2>&1; then
  # Standalone mode: use the global install on PATH (its shebang runs it on bun).
  ST_CLI="software-teams"
else
  echo "Software Teams CLI not found: no bundled plugin dist (\${CLAUDE_PLUGIN_ROOT}/dist/index.js) and no 'software-teams' on PATH." >&2
  echo "The CLI is Bun-native — install bun (https://bun.sh), then install it globally with one of:" >&2
  echo "  bun add -g @websitelabs/software-teams" >&2
  echo "  npm i -g @websitelabs/software-teams" >&2
  exit 1
fi

# Use it:
$ST_CLI --help
```

### Branch summary

1. **Bundled (plugin) —** `${CLAUDE_PLUGIN_ROOT}` set AND
   `${CLAUDE_PLUGIN_ROOT}/dist/index.js` exists → run via `bun`. If the bundle
   exists but `bun` is absent, fail fast (the bundle is Bun-native and node
   cannot run it).
2. **Global (standalone) —** otherwise, if `software-teams` is on `PATH` → use
   it directly. Standalone users with `${CLAUDE_PLUGIN_ROOT}` unset land here
   unchanged (the global binary's `#!/usr/bin/env bun` shebang runs it on bun).
3. **Fail fast —** otherwise echo the missing-runtime message to stderr and
   `exit 1`. The message ALWAYS offers BOTH install commands:
   `bun add -g @websitelabs/software-teams` and
   `npm i -g @websitelabs/software-teams`.

## Consumption convention (the ONE rule every call site follows)

Call sites **reference this fragment by path in prose**, then show the
**resolved token** — they do NOT paste the bash block into every file.

> Resolve the CLI per `commands/_shared/cli-invocation.md`, then run
> `$ST_CLI state plan-ready`.

- ✅ Reference-by-path + show `$ST_CLI <verb> <flags>`.
- ❌ Inlining the full resolution block at each call site.
- ❌ Hand-rolling a per-file variant of the resolution logic.

This convention is identical across all consuming slices (`commands/*.md`,
`agents/*.md`). Swap any bare `software-teams <verb>` to `$ST_CLI <verb>` and
point at this fragment for resolution — no other decisions required.

## Dist-shipping approach (contract for the build/ship slice)

The bundled plugin CLI requires `dist/index.js` to exist **in the committed git
tree** (the plugin loads it directly; there is no install step). The resolved
approach:

- **Un-ignore `dist/`** — remove the `dist/` line from `.gitignore` so the
  built bundle is committed. (`package.json` `files` already lists `dist` for
  npm publishing, so this only affects the git tree.)
- **Commit the built bundle** — `dist/index.js` (~784KB, built `--target=bun`)
  is committed; the plugin loads it from the committed tree and runs it on bun.
- **Build-before-commit + lockstep guard** — a build step regenerates the
  bundle and a lockstep test (mirroring `src/__tests__/version-lockstep.test.ts`)
  keeps the committed `dist/index.js` in sync with source so it cannot drift.
  CI already builds dist before publish (`.github/workflows/publish.yml`).
- **Churn trade-off** — un-ignoring `dist/` adds an ~800KB binary diff to
  release commits. This is the accepted, final decision; the build step landing
  alongside version bumps keeps churn to release commits.
