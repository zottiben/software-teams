# Migrating from 0.13.x to 1.0.0

1.0.0 moves Software Teams onto Claude Code's own extension points. Most of the
change is deletion: things the harness now does better are gone, and what
remains is the part it does not do.

`software-teams init` performs the migration. Run it once per project:

```bash
bun add -g @websitelabs/software-teams   # or npm i -g
cd your-project
software-teams init
```

It is idempotent and preserves your own content. Re-run it after upgrading.

---

## Commands are now skills

`.claude/commands/st/*.md` is retired. Skills are the supported extension point.

| Before | After |
|---|---|
| `/st:create-plan` | `/st-create-plan` |
| `/st:implement-plan` | `/st-implement-plan` |
| `/st:*` (colon) | `/st-*` (hyphen) |

The colon form cannot be expressed as a project skill directory, so the
separator changed. Plugin users can also use the explicit
`/software-teams:<name>` namespace.

`init` removes the generated `.claude/commands/st/` tree for you. Commands you
wrote yourself elsewhere under `.claude/commands/` are untouched.

**Two skills were retired in favour of Claude Code's own:**

| Retired | Use instead |
|---|---|
| `/st:verify` | `/verify` |
| `/st:pr-review` | `/code-review` |

Deterministic adapter gates are still available from the terminal as
`software-teams verify`.

---

## Rules moved to `.claude/rules/`

Team conventions now live where Claude Code loads them natively.

| Before | After |
|---|---|
| `.software-teams/rules/general.md` | `.claude/rules/general.md` |
| `.software-teams/rules/backend.md` | `.claude/rules/backend.md` (path-scoped) |
| `.claude/RULES.md` (generated) | `.claude/rules/software-teams.md` |
| `.software-teams/rules/commits.md`, `deviations.md` | retired |

`init` migrates learned rules automatically, preserves categories you added,
and retires the two framework procedure files. `general.md` has no `paths:`
frontmatter, so it loads at session start; the domain files are path-scoped and
load only when Claude reads a matching file.

**Learned rules are no longer gitignored.** They are team conventions and are
meant to be committed. Only the framework-owned `rules/software-teams.md` is
regenerated and ignored.

If `init` warns that your `CLAUDE.md` still references `.software-teams/rules`,
that is a custom instruction it deliberately did not rewrite. Move it to
`.claude/rules/` by hand.

---

## Worktrees are Claude Code's

The bespoke worktree commands are gone.

| Before | After |
|---|---|
| `/st:worktree <name>` | `claude --worktree <name>`, or ask Claude to work in a worktree |
| `/st:worktree-merge <name>` | `git merge` the branch; Claude Code cleans the worktree up on exit |
| `/st:worktree-remove <name>` | Automatic on exit, or `git worktree remove` |
| adapter `env_setup` copying `.env` | `.worktreeinclude` |
| per-spec worktree prose | `isolation: worktree` in subagent frontmatter |

One piece has no native equivalent: provisioning a database or web server.
That is now:

```bash
software-teams provision-worktree              # full setup
software-teams provision-worktree --lightweight  # deps + migrations only
```

Run it inside a worktree Claude Code already created. Your existing adapter
`worktree:` config is unchanged and still drives it.

---

## Agent specs

Specs are ~8.5% smaller per spawn and no longer contain instructions that could
not execute:

- The **Pre-Approval Workflow** is gone. It told subagents to ask the user for
  approval and wait, but `AskUserQuestion` is withheld from every subagent.
  Architectural escalation now returns to the orchestrator, which asks you.
- **`TeamCreate` / `TeamDelete`** calls are gone. Both tools were removed in
  Claude Code v2.1.178; teams start when the first teammate spawns and are
  cleaned up on session exit.
- Reads of `.software-teams/framework/stacks/*.md` are gone. That tree no longer
  exists; stack conventions are fetched with
  `software-teams component get <Name>`.

If you customised a spec, re-apply your changes on top of the new source in
`packages/cli/agents/` and re-run `software-teams sync-agents`.

---

## n8n contract v2

The envelope gained fields; nothing was removed, so a v1 consumer keeps working.

- `retry-later` is a distinct status for subscription-allowance exhaustion. It
  is not a ticket failure and must not be retried in a tight loop.
- `usage`, `sessionId`, `budget`, and `audit[]` are populated on every turn.
- `result.data` carries a validated custom-schema result.

**Auth changed.** `authMode` is explicit and defaults to
`Claude Subscription (OAuth Token)`. API-key billing is now a deliberate
selection rather than whatever the worker environment happened to provide.

If you were relying on `ANTHROPIC_API_KEY` set on the worker, see
[the runbook](packages/n8n/RUNBOOK.md#4c-keep-anthropic_api_key-off-the-worker):
it outranks the OAuth token and silently bills the API.

ClickUp credentials moved out of the combined credential into a separate
**Software Teams ClickUp API** credential, so a read-only poller no longer holds
Claude, GitHub, Slack, SMTP, or Datadog secrets. Recreate it once; the old field
is no longer read.

---

## Checklist

```bash
software-teams init          # migrate rules, install skills, refresh agents
software-teams sync-agents   # if you customised specs
```

- [ ] `/st-*` skills appear in Claude Code
- [ ] `.claude/rules/` holds your learned conventions; commit them
- [ ] No `.software-teams/rules/` directory remains
- [ ] `CLAUDE.md` has no `@.claude/RULES.md` import
- [ ] n8n: recreate the ClickUp credential and re-test the Software Teams API credential
