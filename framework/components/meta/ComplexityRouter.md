# ComplexityRouter Component

Evaluates plan complexity and returns the routing decision for implement-plan.

---

## Decision Matrix

Read the plan index file (frontmatter + task manifest table) and extract these signals:

| Signal | Simple | Complex |
|--------|--------|---------|
| Task count | ≤3 | >3 |
| Tech stacks | Single (PHP-only OR TS-only) | Mixed (PHP + TS/React) |
| Wave count | 1 (all tasks parallel or sequential) | >1 (multi-wave dependencies) |

**Routing rule:** If ANY signal is "Complex" → use Agent Teams mode. All signals must be "Simple" for single-agent mode.

**Override flags:**
- `--team` in command arguments → force Agent Teams mode
- `--single` in command arguments → force single-agent mode

---

## Output

After evaluation, set the routing decision:

```yaml
mode: single-agent | agent-teams
primary_agent: jdi-backend | jdi-frontend  # based on tech stack
secondary_agents: []  # only populated in agent-teams mode
reasoning: "{why this mode was chosen}"
```

---

## Single-Agent Mode

Spawn one specialist agent directly via Task tool. Follow cache-optimised load order (AgentBase first):

```
Task(
  subagent_type: "general-purpose",
  name: "{primary_agent}",
  prompt: "Read .jdi/framework/components/meta/AgentBase.md for the base protocol.
You are {primary_agent}. Read .jdi/framework/agents/{primary_agent}.md for your spec.
If your spec has requires_components in frontmatter, batch-read all listed components before starting.

## Project Context
- Type: {project_type}
- Tech stack: {tech_stack}
- Quality gates: {quality_gates}
- Working directory: {cwd}

## Task
Execute all tasks in the plan sequentially. PLAN: {plan-path}.
For split plans (task_files in frontmatter), read each task file one at a time from the file: field in state.yaml.
Report: files_modified, files_to_create, commits_pending."
)
```

No TeamCreate, no TaskCreate, no cross-agent coordination.

---

## Agent Teams Mode

Follow full orchestration from `.jdi/framework/components/meta/AgentTeamsOrchestration.md`:
TeamCreate → TaskCreate per plan task → spawn specialists per tech-stack routing → wave-based coordination → collect deferred ops → shutdown → TeamDelete.

---

## Usage

```
<JDI:ComplexityRouter />
```

Referenced by implement-plan command stub. Evaluates at orchestration time, before any agents are spawned.
