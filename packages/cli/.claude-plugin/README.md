# Software Teams — Claude Code Plugin

`plugin.json` is the Claude Code plugin manifest. Claude Code discovers the
canonical payloads directly from the package root:

- `skills/<name>/SKILL.md` → `/st-<name>` (bare alias) or
  `/software-teams:<name>` (explicit plugin namespace)
- `agents/software-teams-*.md` → native Software Teams subagents

The npm/CLI distribution installs the same skill sources as project skills under
`.claude/skills/st-<name>/`, also exposed as `/st-<name>`. Both distributions
therefore share one invocation surface and one source tree.

Edit the canonical `skills/` or `agents/` source and run the normal build and
frontmatter gates. Do not maintain a parallel command payload.
