#!/usr/bin/env bash
#
# team-task-quality-gate.sh
# TaskCompleted hook (Agent Teams) — when a teammate marks a task complete, run
# the project's fast quality gates and SURFACE the result to the team.
#
# ADVISORY by design (always exit 0). In a SHARED working tree, teammates work
# concurrently, so hard-blocking (exit 2) on a whole-tree gate would false-block
# the completing task on a PEER's in-progress files. For HARD per-task blocking,
# pair Agent Teams with per-task worktree isolation so each teammate's gate
# scopes to its own tree. (TaskCompleted only fires in Agent Teams mode; this is
# a no-op for non-team runs.)
#
# Wired by the framework into .claude/settings.json:
#   "hooks": { "TaskCompleted": [ { "hooks": [ { "type": "command",
#     "command": ".claude/hooks/team-task-quality-gate.sh" } ] } ] }
#
# Output: JSON additionalContext when a gate fails so the lead/team sees it.
# Never blocks; never breaks the session.
#
# Env: ST_QUALITY_GATE_OFF (disable), ST_QUALITY_GATE_SKIP (default: test), ST_BIN.
#
set -uo pipefail

cat > /dev/null 2>&1 || true
[[ -n "${ST_QUALITY_GATE_OFF:-}" ]] && exit 0

# Only meaningful when there are source changes to check.
if command -v git > /dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  dirty=$(git status --porcelain -- . \
    ':(exclude).software-teams' ':(exclude).claude' ':(exclude).worktrees' 2>/dev/null || true)
  [[ -z "$dirty" ]] && exit 0
fi

# Resolve the software-teams binary (explicit → local → PATH → give up quietly).
st_bin="${ST_BIN:-}"
if [[ -z "$st_bin" ]]; then
  if [[ -x "node_modules/.bin/software-teams" ]]; then st_bin="node_modules/.bin/software-teams"
  elif command -v software-teams > /dev/null 2>&1; then st_bin="software-teams"
  else exit 0; fi
fi
if [[ "$st_bin" == */* ]]; then [[ -x "$st_bin" ]] || exit 0; else command -v "$st_bin" > /dev/null 2>&1 || exit 0; fi

output=$("$st_bin" verify --quiet --skip "${ST_QUALITY_GATE_SKIP:-test}" 2>&1)
[[ $? -eq 0 ]] && exit 0

# Advisory: surface the failure to the team; do NOT block (exit 0).
msg="Software Teams quality gates are RED after a task was marked complete (advisory — not blocking, shared tree). $output -- The team lead should identify whose change broke them and coordinate a fix (or run a per-task worktree gate)."
esc=$(printf '%s' "$msg" | tr '\n\r' '  ' | tr -d '\\"')
printf '{"hookSpecificOutput":{"hookEventName":"TaskCompleted","additionalContext":"%s"}}\n' "$esc"
exit 0
