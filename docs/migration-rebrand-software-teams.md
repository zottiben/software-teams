# Migration: JDI → Software Teams (Rebrand)

This release renames the project from **JDI** to **Software Teams**. Every user-visible
identifier — package name, CLI binary, slash-command prefix, state directory, config
filename, environment variables, and repo URL — has changed in lockstep. This is a one-time
migration; once you are on the new package, everything works the same.

> Companion docs: [`migration-native-subagents.md`](./migration-native-subagents.md) (v0.2.0
> native-subagents work) and [`rollback-rebrand-software-teams.md`](./rollback-rebrand-software-teams.md)
> (internal rollback playbook for the team).

---

## What changed

The framework is now distributed under a new identity that reflects what it actually does:
spawn a team of specialised agents. The old `jdi` shorthand is gone everywhere.

- **Brand.** "JDI" is now "Software Teams". The product name in prose, README, and docs
  is **Software Teams** (two words, capitalised).
- **npm package.** `@benzotti/jdi` → `@benzotti/software-teams`. The old package is
  `npm deprecate`d with a pointer at the new one.
- **CLI binary.** `jdi` → `software-teams`. The CLI subcommands and flags are unchanged.
- **Two slash-command prefixes (new).** Software Teams now ships through two channels:
  the npm CLI uses `/st:*` (short, terminal-friendly); the Claude Code plugin uses
  `/software-teams:*` (the manifest namespace). Both invoke the same content. Pick the
  one that matches your install method — see [Slash command prefixes](#slash-command-prefixes)
  below.
- **State directory.** `.jdi/` → `.software-teams/`. The internal layout is unchanged.
- **Config filename.** `.jdi/config/jdi-config.yaml` → `.software-teams/config/software-teams-config.yaml`.
- **Environment variables.** `JDI_*` → `SOFTWARE_TEAMS_*` (e.g. `JDI_AUTH_ENABLED` is
  now `SOFTWARE_TEAMS_AUTH_ENABLED`).
- **Repo URL.** `github.com/zottiben/jdi` → `github.com/zottiben/software-teams`. GitHub
  redirects existing clones, issues, and PRs from the old URL to the new one
  automatically — you do not need to re-clone, but updating your remote is recommended.

---

## How to upgrade

Pick **one** of the install methods. They are equivalent — both ship from the same
source of truth (`framework/`).

### Option A — npm CLI (most users)

Uninstall the old package and install the new one.

```bash
# Remove the old global install (if you had one)
bun remove -g @benzotti/jdi    # or: npm uninstall -g @benzotti/jdi

# Install the new package
bun install -g @benzotti/software-teams
# or, no install: bunx @benzotti/software-teams init
```

If you ran `bun install -g @benzotti/jdi` previously and you only ever invoked it as
`bunx`, you do not need to uninstall — `bunx @benzotti/software-teams init` works
immediately and the deprecation warning on the old package is your only nudge.

### Option B — Claude Code plugin (one-command install)

If you use Claude Code, install the plugin from the renamed repo:

```text
/plugin install zottiben/software-teams
```

This pulls the generated `agents/` and `commands/` trees and registers the
`/software-teams:*` slash commands inside Claude Code. No npm install needed.

---

## Migrate an existing project

If you have a project with a `.jdi/` directory and a `jdi-config.yaml`, run these
commands once from the project root:

```bash
# 1. Rename the state directory
mv .jdi .software-teams

# 2. Rename the config file
mv .software-teams/config/jdi-config.yaml .software-teams/config/software-teams-config.yaml

# 3. Rename any environment variables you set in your shell / CI
#    (replace JDI_ with SOFTWARE_TEAMS_)
#    Example: JDI_AUTH_ENABLED=true → SOFTWARE_TEAMS_AUTH_ENABLED=true

# 4. Regenerate the agent / doctrine artefacts
software-teams sync-agents
```

If you have a GitHub Action wired up via `.github/workflows/jdi.yml`:

```bash
# 5. Rename the workflow file
git mv .github/workflows/jdi.yml .github/workflows/software-teams.yml

# 6. Re-run setup-action to get the latest workflow shape
software-teams setup-action
```

The trigger phrase in PR / issue comments has changed from `Hey jdi …` to
`Hey software-teams …`.

---

## Slash command prefixes

Software Teams ships the same content through two distribution channels. Each channel
gets its own slash-command namespace. Both work; pick by how you installed.

| You installed via … | Use this prefix     | Example                    |
|---------------------|---------------------|----------------------------|
| npm CLI (`bunx @benzotti/software-teams`) | `/st:*`             | `/st:create-plan`          |
| Claude Code plugin  | `/software-teams:*` | `/software-teams:create-plan` |

The two prefixes invoke the same skills — they exist because Anthropic's plugin
spec uses the manifest `name` field (`software-teams`) as the slash-command namespace,
while the CLI keeps the shorter `st` prefix for terminal ergonomics.

The legacy `/jdi:*` prefix is **gone**. If you have personal aliases or notes
referencing `/jdi:create-plan`, update them to `/st:create-plan` (CLI) or
`/software-teams:create-plan` (plugin).

---

## Repo URL change and GitHub redirects

The repo moved from `github.com/zottiben/jdi` to `github.com/zottiben/software-teams`.
GitHub preserves all of the following automatically via 301 redirects:

- Old clones (`git fetch` / `git pull` keep working)
- Issue and PR links (deep links still resolve)
- Release assets and tag URLs

You do not have to re-clone. To remove the redirect indirection on a local clone, run:

```bash
git remote set-url origin git@github.com:zottiben/software-teams.git
```

If you bookmark the repo, update your bookmarks at your convenience — the old URL
will keep redirecting indefinitely.

---

## Troubleshooting

- **`command not found: jdi`** — expected. The binary is now `software-teams`. Update
  scripts and aliases.
- **`/jdi:create-plan` returns "unknown command"** — expected. Use `/st:create-plan`
  (CLI install) or `/software-teams:create-plan` (plugin install).
- **`.jdi/` and `.software-teams/` both exist** — safe. Verify `.software-teams/`
  contains your latest state, then delete `.jdi/`. The CLI only reads `.software-teams/`.
- **`JDI_*` env vars in CI silently ignored** — expected. Rename them to
  `SOFTWARE_TEAMS_*`.
- **Old npm install warning** — expected. `@benzotti/jdi` is deprecated; the warning
  points at `@benzotti/software-teams`. Migrate when convenient.

If you hit an issue not covered here, open an issue on
[zottiben/software-teams](https://github.com/zottiben/software-teams/issues).
