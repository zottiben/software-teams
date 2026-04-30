# Software Teams — Claude Code Plugin

This directory holds the manifest (`plugin.json`) for the **Software Teams** Claude
Code plugin. The plugin's content tree (`agents/` and `commands/` at the repo root)
is **not hand-maintained** — it is built deterministically from `framework/` by the
plugin build step (owned by task T10 in plan `2-01-rebrand-software-teams`). If you
need to change an agent or a slash command, edit the source under
`framework/agents/` or `framework/commands/` and re-run the build; the generated
tree is the artefact, not the source.

## Why two slash-command prefixes?

Software Teams ships through **two distribution channels** that target the same
underlying content, and each channel has its own slash-command namespace:

- **`/st:*`** — the **CLI** layer. Installed via `bunx @benzotti/software-teams init`
  (or a global npm install). Slash commands live in `.claude/commands/st/` inside the
  consuming repo and are wired up by `software-teams sync-agents`. Use this when you
  want the framework checked into your project's repo and version-controlled with it.
- **`/software-teams:*`** — the **plugin** layer. Installed via Claude Code's plugin
  loader. Per Anthropic's plugin spec, the manifest's `name` field
  (`software-teams`) becomes the slash-command namespace, so plugin invocations look
  like `/software-teams:create-plan`. Use this when you want a zero-config install
  with no files committed to your repo.

Both prefixes resolve to the same agent + command definitions (single source of
truth in `framework/`); only the install path and namespace differ. The decision to
keep both was recorded as RQ-01 in the rebrand spec.
