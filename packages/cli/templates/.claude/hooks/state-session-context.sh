#!/usr/bin/env bash
#
# state-session-context.sh
# SessionStart hook — re-injects a compact Software Teams orchestration summary
# (plan · status · phase · task progress) from `.software-teams/state.yaml` as
# `additionalContext`, so the orchestrator re-acquires state on startup, resume,
# and — most importantly — AFTER A CONTEXT COMPACTION (`source: compact`). This
# is the state-durability mechanism: PreCompact cannot inject context, and
# state.yaml is already the durable store, so re-injecting it on SessionStart is
# what survives compaction.
#
# Wired by the framework into .claude/settings.json:
#   "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
#     "command": ".claude/hooks/state-session-context.sh" } ] } ] }
#
# Output contract (Claude Code SessionStart): print JSON to stdout —
#   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
# Claude inserts `additionalContext` as a system reminder at the event point.
#
# NEVER breaks the session: no state file, no active plan, or any error → exit 0
# with no output. jq-free, stdlib-shell only.
#
set -uo pipefail

# Drain the stdin payload (we read state from disk, not the payload).
cat > /dev/null 2>&1 || true

STATE=".software-teams/state.yaml"
[ -f "$STATE" ] || exit 0

# Extract a unique scalar field (state.yaml is machine-written; these keys are
# unique across the file, so a line-anchored grep is reliable).
val() {
  grep -E "^[[:space:]]*$1:" "$STATE" 2>/dev/null | head -1 \
    | sed -E "s/^[[:space:]]*$1:[[:space:]]*//; s/^[\"']//; s/[\"']\$//"
}

plan=$(val plan_name)
case "$plan" in ""|"null"|"~") exit 0 ;; esac   # no active plan → stay silent

status=$(val status)
phase=$(val phase_name)
done=$(val tasks_completed)
total=$(val tasks_total)

# Sanitise values for safe embedding in a JSON string literal (drop newlines,
# backslashes, and double-quotes — these are short names/ids).
san() { printf '%s' "$1" | tr -d '\n\r\\"'; }
plan=$(san "$plan"); status=$(san "$status"); phase=$(san "$phase")
done=$(san "$done"); total=$(san "$total")

summary="Software Teams — active plan: '${plan}'"
case "$status" in ""|"null") ;; *) summary="${summary} [${status}]" ;; esac
case "$phase" in ""|"null") ;; *) summary="${summary}; phase: ${phase}" ;; esac
case "$total" in ""|"null"|"0") ;; *) summary="${summary}; tasks ${done:-0}/${total}" ;; esac
summary="${summary}. Resume with /st:status or /st:implement-plan; full state in .software-teams/state.yaml."

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$summary"
exit 0
