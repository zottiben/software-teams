# Plan: three-tier artifacts contract

When a plan is emitted in three-tier mode, the planner MUST write exactly the three artifact kinds described below under `.software-teams/plans/`. This contract is shared by the local `/st:create-plan` skill (when its Tier Decision Rule resolves to three-tier) and the GitHub Action's prompt builder (which always demands three-tier). The "always" requirement for the action is enforced where the fragment is consumed, not here — this fragment is artifact-shape only.

## Required artifacts (three-tier mode, no exceptions)

1. **`{slug}.spec.md`** — requirements + acceptance criteria. Plain markdown, optional frontmatter.

2. **`{slug}.orchestration.md`** — the tasks manifest. Frontmatter MUST include:
   - `available_agents:` — list of subagent types the planner considered
   - `primary_agent:` — the lead agent for this plan
   - `task_files:` — list of every per-agent slice path
   - `issue: <N>` *(action only)* — the issue number this plan addresses; the action's runner uses it to find the plan when implementing
   - `repo: <owner>/<name>` *(action only)* — the repository this plan was authored against

   Body contains the Tasks manifest table: `ID | Task | Agent | Priority | Requires`.

3. **`{slug}.T{n}.md` per-agent slices** — one per task. Each slice's frontmatter MUST include:
   - `agent:` — the specific subagent type (e.g. `software-teams-frontend`, `software-teams-backend`)
   - `tier: per-agent`
   - `spec_link:` — path back to the spec file
   - `orchestration_link:` — path back to the orchestration file

   Single-task plans still produce exactly one `.T1.md` slice.

## Forbidden in three-tier mode

- **Do NOT write `{slug}.plan.md`** — that is the legacy single-tier index. It must not appear in any three-tier output. The action's runner explicitly forbids it; the skill's three-tier verifier treats it as legacy-optional.
