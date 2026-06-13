#!/usr/bin/env bash
#
# quality-gate.sh
# SubagentStop hook — runs the project's FAST quality gates after a specialist
# subagent completes, so quality enforcement is deterministic instead of
# depending on the orchestrator remembering to spawn the QA tester.
#
# Wired by the framework into .claude/settings.json:
#   "hooks": {
#     "SubagentStop": [
#       { "hooks": [ { "type": "command",
#         "command": ".claude/hooks/quality-gate.sh" } ] }
#     ]
#   }
#
# ─── BEHAVIOUR ──────────────────────────────────────────────────────────────
#
#   1. If the working tree has no uncommitted SOURCE changes (ST runtime dirs
#      .software-teams/ .claude/ .worktrees/ are ignored), exit 0 immediately —
#      the subagent did not touch code (e.g. a researcher/planner), so there is
#      nothing to gate. Keeps the gate near-free for non-code specialists.
#   2. Otherwise run `software-teams verify --skip "$ST_QUALITY_GATE_SKIP"
#      --quiet`. The default skip set is `test`: the full suite is the QA
#      tester's job; lint / analyse / typecheck-style gates run here for fast
#      per-specialist feedback.
#   3. On gate failure: print the failing output and exit 2, surfacing the
#      failure back to the agent. On pass / no gates / CLI missing: exit 0.
#
#   This hook NEVER hard-fails the session for infrastructure reasons: a
#   missing CLI, no git, or an unreadable tree all resolve to exit 0. The only
#   non-zero exit is a genuine quality-gate failure.
#
# ─── ENV ────────────────────────────────────────────────────────────────────
#
#   ST_QUALITY_GATE_SKIP   comma-separated gate names to skip (default: test)
#   ST_QUALITY_GATE_ONLY   comma-separated gate names to run exclusively
#   ST_BIN                 explicit path to the software-teams binary
#   ST_QUALITY_GATE_OFF    set to any value to disable this hook entirely
#
# ───────────────────────────────────────────────────────────────────────────

set -uo pipefail

# Always drain stdin (Stop/SubagentStop deliver a JSON payload we don't need)
# so the producer is never left blocking on a full pipe.
cat > /dev/null 2>&1 || true

# Opt-out escape hatch.
[[ -n "${ST_QUALITY_GATE_OFF:-}" ]] && exit 0

# 1. Fast path: skip when no source files changed. ST runtime dirs are excluded
#    so framework state churn never trips the gate. An inclusive `.` pathspec is
#    required alongside the `:(exclude)` magic pathspecs.
if command -v git > /dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  dirty=$(git status --porcelain -- . \
    ':(exclude).software-teams' \
    ':(exclude).claude' \
    ':(exclude).worktrees' 2>/dev/null || true)
  [[ -z "$dirty" ]] && exit 0
fi

# 2. Resolve the software-teams binary: explicit override → local install →
#    PATH → give up quietly (never block a project that lacks the CLI on PATH).
st_bin="${ST_BIN:-}"
if [[ -z "$st_bin" ]]; then
  if [[ -x "node_modules/.bin/software-teams" ]]; then
    st_bin="node_modules/.bin/software-teams"
  elif command -v software-teams > /dev/null 2>&1; then
    st_bin="software-teams"
  else
    exit 0
  fi
fi

# Validate the resolved binary is actually runnable — a path-style value must be
# executable, a bare name must be on PATH. An unrunnable binary (e.g. a stale
# ST_BIN override) is an infrastructure issue, not a quality failure: exit 0.
if [[ "$st_bin" == */* ]]; then
  [[ -x "$st_bin" ]] || exit 0
else
  command -v "$st_bin" > /dev/null 2>&1 || exit 0
fi

# 3. Run the selected fast gates.
verify_args=(verify --quiet)
if [[ -n "${ST_QUALITY_GATE_ONLY:-}" ]]; then
  verify_args+=(--gate "${ST_QUALITY_GATE_ONLY}")
fi
verify_args+=(--skip "${ST_QUALITY_GATE_SKIP:-test}")

output=$("$st_bin" "${verify_args[@]}" 2>&1)
code=$?

if [[ "$code" -ne 0 ]]; then
  printf 'Software Teams quality gate FAILED after a specialist completed:\n\n%s\n\nFix the above (or delegate the fix to a specialist) before advancing. The orchestrator can re-run the gate with `%s verify`.\n' \
    "$output" "$st_bin" >&2
  exit 2
fi

exit 0
