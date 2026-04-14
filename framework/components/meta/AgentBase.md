# AgentBase Component

Standards inherited by all JDI agents via `<JDI:AgentBase />`. Default loads Core only.

## Standards

- Use **Australian English** spelling in all outputs.
- Follow `CLAUDE.md` and `.claude/rules/` conventions.
- Read `.jdi/config/state.yaml` once at task start for context. Do NOT update state.yaml for status transitions — the framework handles this. Only use state.yaml to record decisions, deviations, or blockers via `<JDI:StateUpdate />`.
- Use the Read tool before editing any file.
- Batch file reads: issue all Read calls in a single turn rather than sequentially.
- Batch git operations: combine related commands into a single Bash call where possible.

## Budget Discipline

You have a finite per-invocation budget (tokens, tool calls, wall time). Long runs can be terminated mid-task before you produce your final report. To survive:

1. **Batch reads in parallel** — one turn with all Read calls, not sequential.
2. **Cap exploration** — read only the files your spawn prompt names. If more are needed, report what you need and stop rather than wandering.
3. **Write fixes before verifying** — Edit calls persist even if you are later truncated. Save the report for last.
4. **Short reports (<400 words)** — terse file list + one sentence per change. Long formal reports are where truncation bites.
5. **One concern per invocation** — address what was asked, do not expand scope.
6. **Don't re-read files you just edited** — the harness tracks state.

If your work exceeds one invocation, complete what you can, return a progress report naming exactly what remains, and let the orchestrator re-spawn you.

## Component Resolution

When a spec contains `<JDI:*>` tags:
1. Read the file from `.jdi/framework/components/` (execution/, planning/, quality/, meta/).
2. If a section is specified (`<JDI:X:Section />`), execute only that section.
3. Apply tag parameters as constraints. Return to agent spec and continue.

If your spec has a `requires_components` frontmatter field, read ALL listed components before starting execution.

Do NOT skip `<JDI:*>` tags — they contain essential instructions.

## Activation Protocol

On activation, announce and begin immediately:
```
You are now active as {agent-name}. {Action verb} as requested.
```

## Structured Returns

Return a YAML block with `status`, agent-specific fields, and `next_action` after all work is complete.

## Boundaries

- **Will Do**: Actions within agent responsibility. Prioritise these.
- **Will Not**: Actions outside scope. Delegate or escalate, never attempt.

---

<section name="Sandbox">

## File Operations

You are spawned with `mode: "acceptEdits"` and a scoped `allowedTools` allowlist (declared in `.claude/settings.json` and mirrored in `src/utils/claude.ts`). The allowlist covers Read/Write/Edit/MultiEdit/Glob/Grep/Task plus scoped `Bash(bun:*)`, `Bash(git:*)`, `Bash(gh:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(mkdir:*)`, `Bash(rm:*)`, `Bash(jdi:*)`. All standard tools work within that scope:

| Operation | Tool / Method | Notes |
|-----------|--------------|-------|
| Edit existing files | Edit tool | Primary way to modify code |
| Create new files | Write tool | Works — create files directly |
| Delete files | Bash `rm` | Destructive — use with care |
| Read files | Read tool | Works reliably |
| Run commands | Bash tool | Output is real; side-effects vary |

**Key Rules:**
1. **Use the Edit tool** to modify existing files (read first).
2. **Use the Write tool** to create new files directly — do NOT defer to the orchestrator.
3. **Do NOT run `git commit`** — the orchestrator handles commits after all tasks complete. Report commits needed in `commits_pending`.

### Structured Returns

```yaml
files_modified:
  - path/to/edited/file1.ts
files_created:
  - path/to/new/file.md
commits_pending:
  - message: |
      feat(01-01-T1): implement feature X
    files:
      - path/to/modified/file1.ts
      - path/to/new/file.md
```

### Orchestrator Post-Agent Handling

After an agent completes, the orchestrator:
1. Executes commits from `commits_pending` via `git add` + `git commit`
2. Records real commit hashes in `.jdi/config/state.yaml`

</section>

---

<section name="TeamMode">

## Communication (Team Mode)

When operating within an Agent Team (spawned by coordinator):

1. **Claim tasks**: Call TaskList, find tasks assigned to you
2. **Execute**: Read task description, implement using Edit tool
3. **Report**: SendMessage to coordinator with structured return (include `files_modified`, `files_created`, `commits_pending`)
4. **Complete**: TaskUpdate(status: "completed") AFTER sending results
5. **Next**: Check TaskList for more assigned tasks. If none, go idle.

**Team Mode Rules:**
- NEVER write to state.yaml (coordinator handles this)
- ALWAYS SendMessage results to coordinator before TaskUpdate(completed)
- Use **SendMessage** to communicate — plain text is not visible to teammates.

</section>
