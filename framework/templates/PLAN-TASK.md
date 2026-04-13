---
plan_id: {phase}-{plan}
task_id: {phase}-{plan}-T{n}
task_name: {Task Name}
type: auto
wave: 1
depends_on: []

# Agent routing (written by jdi-planner via AgentRouter — see
# framework/components/meta/AgentRouter.md). implement-plan reads `agent` and
# passes it as `subagent_type` when spawning via the Task tool. `agent_rationale`
# is a human-readable justification so reviewers can challenge the pick.
agent: general-purpose
agent_rationale: "{Why this specialist was chosen}"
---

# Task {n}: {Task Name}

**Objective:** {What this task accomplishes}

**Files:**
- `{path/to/file.ts}` - {what changes}
- `{path/to/file2.ts}` - {what changes}

**Implementation:**
1. {Step 1}
2. {Step 2}
3. {Step 3}

**Verification:**
- [ ] {Check 1}
- [ ] {Check 2}

**Done when:**
- {Specific, observable completion criterion}

---

## Test Task Variant

When `type: test`, the frontmatter includes additional fields:

```yaml
---
type: test
test_scope: [unit, integration, e2e, component]
test_framework: "{detected framework}"
test_command: "{detected test command}"
tests_for_wave: {N}
---
```

The Implementation section for test tasks follows this structure:

**Test Cases:**
- [ ] {test case 1 — derived from implementation task done_when}
- [ ] {test case 2}

**Test Files to Create:**
- `{path/to/test-file.test.ts}` — {what it tests}

**Run Command:**
```
{test_command} {test file pattern}
```
