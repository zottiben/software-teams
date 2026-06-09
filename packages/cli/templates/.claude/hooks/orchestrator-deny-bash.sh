#!/usr/bin/env bash
#
# orchestrator-deny-bash.sh
# PreToolUse hook for Orchestrator-Only Mode.
#
# Invoked by the Claude Code PreToolUse runtime for the matcher:
#   Edit|Write|NotebookEdit|Bash
#
# Exit codes:
#   0  → allow the tool call
#   2  → deny the tool call (Claude Code treats exit 2 as a hard block)
#
# To toggle off: /st:orchestrator-mode off
#
# ─── EXEMPTIONS ────────────────────────────────────────────────────────────
#
#   The restriction is meant for the MAIN Claude Code thread only. Two kinds
#   of delegated context are exempted:
#
#   1. Task-spawned subagents. Detected via the `agent_id` field, which
#      Claude Code adds to the hook payload only inside subagent contexts.
#
#   2. Teammate sessions (Agent Teams / TeamCreate / `claude agents`).
#      These are full Claude Code processes spawned in tmux panes; they
#      load the project's `.claude/settings.json` (so they inherit this
#      hook) but they have no `agent_id` in the payload. Detect them via
#      the env vars Claude Code itself sets on background-spawned sessions:
#        CLAUDE_BG_SOURCE / CLAUDE_BG_BACKEND / CLAUDE_BG_ISOLATION /
#        CLAUDE_CODE_SESSION_NAME / CLAUDE_BG_SESSION_PERMISSION_RULES.
#      Bash hooks inherit the parent process env, so any one of these
#      being set means the call originated inside a teammate process and
#      must be allowed through.
#
# ─── DENY PATTERN SET (canonical — audit here, not in the regex blocks) ────
#
#   Orchestrator-Only Mode keeps the MAIN thread free to MANAGE and DELIVER
#   the work via Bash — commit, push, open PRs, install deps, run builds and
#   tests, etc. What it must NOT do is AUTHOR or DESTROY code directly; that
#   is delegated to specialists via the Task tool. So this hook blocks only
#   the tools/commands that write, overwrite, delete, move, or revert source.
#
#   Non-Bash tools (always blocked when this hook is installed):
#     Edit, Write, NotebookEdit
#
#   Bash deny patterns — destroy/revert tree state, or write file content in
#   place (i.e. editing code through the shell):
#     git reset --hard\b
#     git checkout -- (space — distinguishes from "git checkout main")
#     git restore \. (dot — distinguishes from "git restore --staged foo")
#     git clean -f\b
#     (^|[^a-zA-Z_])rm \b
#     (^|[^a-zA-Z_])mv \b
#     (^|[^a-zA-Z_])cp \b  [NOTE: always denied — no reliable read-only cp detection]
#     (^|[^a-zA-Z_])tee \b
#     sed -i\b
#     > [non-slash, non-& char] AND NOT > /dev/null  (file redirect; fd
#       duplications like 2>&1 / >&2 / >&- pass through)
#     >& <file> / &> <file>  (csh-style redirect to a file)
#     >>  (append redirect — always denied)
#
#   Explicitly ALLOWED — delivery / management plumbing, NOT blocked:
#     git commit, git push, git rebase, git branch -D, git status/log/diff
#     npm/bun/pnpm/yarn install|add|remove, make, gh pr|issue *, sudo, and
#     any other Bash command not in the deny set above.
#
# FALSE-POSITIVE RISK (R-2): The rm/mv/cp/tee patterns use a negative
# look-behind character class to avoid matching "form", "chmod", etc., but
# they cannot exclude these commands when they appear inside string arguments.
# Accept the false positive; toggle off if needed.
#
# ───────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Dependency check ────────────────────────────────────────────────────────
if ! command -v jq > /dev/null 2>&1; then
  printf 'orchestrator-mode: jq is required for hook enforcement (brew install jq)\n' >&2
  exit 2
fi

# ── Read and parse payload ───────────────────────────────────────────────────
payload=$(cat)

tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
if [[ -z "$tool" ]]; then
  printf 'orchestrator-mode: malformed hook payload (no tool_name)\n' >&2
  exit 2
fi

# ── Subagent exemption ──────────────────────────────────────────────────────
# Claude Code populates `agent_id` on the hook payload only when the call
# originates inside a Task-spawned subagent. The orchestrator-only restriction
# applies to the MAIN thread; specialist agents must remain free to mutate.
# Allow unconditionally when agent_id is present.
agent_id=$(printf '%s' "$payload" | jq -r '.agent_id // empty')
if [[ -n "$agent_id" ]]; then
  exit 0
fi

# ── Teammate exemption ──────────────────────────────────────────────────────
# Agent Teams (TeamCreate / `claude agents`) spawn full Claude Code processes
# in tmux panes. They load the project's .claude/settings.json — so they
# inherit this hook — but they are NOT Task subagents, so no agent_id is set.
# Claude Code marks teammate processes via the env vars below; bash hooks
# inherit the parent process env, so we can detect the case here. The same
# detection set is used inside the Claude Code binary to recognise
# background-spawned sessions.
if [[ -n "${CLAUDE_BG_SOURCE:-}" \
   || -n "${CLAUDE_BG_BACKEND:-}" \
   || -n "${CLAUDE_BG_ISOLATION:-}" \
   || -n "${CLAUDE_CODE_SESSION_NAME:-}" \
   || -n "${CLAUDE_BG_SESSION_PERMISSION_RULES:-}" ]]; then
  exit 0
fi

# ── Branch on tool name ──────────────────────────────────────────────────────
case "$tool" in
  Edit|Write|NotebookEdit)
    printf "orchestrator-mode: Tool '%s' is blocked while Orchestrator-Only Mode is on.\nDelegate to a specialist via the Task tool, or run:\n  /st:orchestrator-mode off\nto disable the hook.\n" "$tool" >&2
    exit 2
    ;;

  Bash)
    command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')

    deny() {
      local pattern="$1"
      printf "orchestrator-mode: Bash command matched deny pattern '%s'.\nThis writes or destroys code directly — delegate it to a specialist via the\nTask tool, or run:\n  /st:orchestrator-mode off\nto disable the hook. (Delivery commands — git commit/push, installs, make,\ngh, read-only git — are allowed.)\n" "$pattern" >&2
      exit 2
    }

    # git mutations that DESTROY or REVERT tree state. Delivery-oriented git —
    # commit, push, rebase, branch -D — is ALLOWED: the orchestrator owns
    # shipping the outcome.
    [[ "$command" =~ git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$) ]] && deny 'git reset --hard\b'
    [[ "$command" =~ git[[:space:]]+checkout[[:space:]]--[[:space:]] ]] && deny 'git checkout -- '
    [[ "$command" =~ git[[:space:]]+restore[[:space:]]\. ]] && deny 'git restore \.'
    [[ "$command" =~ git[[:space:]]+clean[[:space:]]+-f([[:space:]]|$) ]] && deny 'git clean -f\b'

    # file system mutations — deleting, moving, copying, or writing file
    # content in place is "editing code" and must be delegated.
    [[ "$command" =~ (^|[^a-zA-Z_])rm[[:space:]] ]] && deny '(^|[^a-zA-Z_])rm \b'
    [[ "$command" =~ (^|[^a-zA-Z_])mv[[:space:]] ]] && deny '(^|[^a-zA-Z_])mv \b'
    [[ "$command" =~ (^|[^a-zA-Z_])cp[[:space:]] ]] && deny '(^|[^a-zA-Z_])cp \b'
    [[ "$command" =~ (^|[^a-zA-Z_])tee[[:space:]] ]] && deny '(^|[^a-zA-Z_])tee \b'
    [[ "$command" =~ sed[[:space:]]+-i([[:space:]]|$) ]] && deny 'sed -i\b'

    # redirect mutations — `> file` / `>> file` writes file content directly.
    # Allow fd duplications (2>&1, >&2, >&-) and redirects to /dev/null or
    # absolute paths; still block writes to a (relative) file, including the
    # csh-style `>& file` / `&> file` forms. These regexes contain `&`, which
    # must be held in a variable so bash does not parse it as a shell operator.
    file_redirect_re='>[[:space:]]*[^/&[:space:]]'
    fd_to_file_re='(>&|&>)[[:space:]]*[^-/0-9[:space:]]'
    if [[ "$command" =~ $file_redirect_re ]] && [[ ! "$command" =~ \>[[:space:]]*/dev/null ]]; then
      deny '> [file redirect]'
    fi
    if [[ "$command" =~ $fd_to_file_re ]]; then
      deny '>& [file redirect]'
    fi
    [[ "$command" =~ \>\> ]] && deny '>>'

    # No pattern matched — allow (delivery/management Bash falls through here:
    # git commit/push/rebase, npm/bun/pnpm/yarn installs, make, gh, sudo, …)
    exit 0
    ;;

  *)
    # Unexpected tool name — allow (the hook matcher in settings.json already
    # limits invocation, but this defends in depth)
    exit 0
    ;;
esac

# Allow case:
#   printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | ./templates/.claude/hooks/orchestrator-deny-bash.sh; echo $?
#   → prints nothing, exits 0
# Deny case:
#   printf '{"tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' | ./templates/.claude/hooks/orchestrator-deny-bash.sh; echo $?
#   → prints deny message to stderr, exits 2
