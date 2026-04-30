---
name: TaskBreakdown
category: planning
description: Break requirements or features into executable tasks
params:
  - name: source
    type: string
    options: ["requirements", "feature", "ticket", "freeform"]
    default: "freeform"
  - name: depth
    type: string
    options: ["shallow", "standard", "deep"]
    default: "standard"
  - name: mode
    type: string
    options: ["default", "dependencies"]
    default: "default"
---

# TaskBreakdown

## Default Behaviour

1. **Understand the input** — what is being built, acceptance criteria, constraints
2. **Identify components** — subsystems involved, files to touch, dependencies
3. **Create task list** — each task is atomic (one commit), verifiable, ordered by dependency
4. **Output structured tasks** using the format below

---

## Task Format

```markdown
<task id="{N}" type="auto|checkpoint:*|test" tdd="true|false" wave="{W}" priority="must|should|nice">

## Task {N}: {Name}

**Priority:** must | should | nice

**Objective:** {What this task accomplishes}

**Files:**
- `path/to/file1.ts` - {what changes}

**Implementation:**
1. {Step 1}
2. {Step 2}

**Verification:**
- [ ] {Verification check}

**Done when:**
- {Specific, observable completion criteria}

</task>
```

Task types: `auto` (execute without stopping), `checkpoint:human-verify`, `checkpoint:decision`, `checkpoint:human-action`, `test` (auto-generated test task)

---

## Dependency Analysis (mode="dependencies")

For each task, identify:
- **Hard dependencies**: Must complete in order (e.g., types needed by implementation)
- **Soft dependencies**: Prefer order but can parallelise
- **External dependencies**: May require checkpoint

### Wave Assignment

Tasks with no dependencies → Wave 1. Tasks depending on Wave N → Wave N+1.

---

## From Requirements (source="requirements")

When breaking down from REQUIREMENTS.yaml: map REQ-IDs to tasks, track which tasks satisfy which requirements, ensure every in-scope requirement has at least one task.

---

## Granularity

- **shallow**: 4-6 high-level tasks per feature
- **standard**: 6-10 balanced tasks (default)
- **deep**: 10-20 fine-grained tasks for complex/unfamiliar work

---

## Priority Bands

Every task MUST be tagged with one of three priority bands:

- **Must Have** (critical path — plan fails if not delivered)
- **Should Have** (planned but droppable under pressure)
- **Nice to Have** (delivered only with surplus capacity)

---

## See Also: Three-Tier Output

This component describes the **mode-agnostic algorithm** for breaking down work into tasks — it applies the same way whether the planner emits single-tier (`PLAN.md` + per-task) or three-tier (`SPEC.md` + `ORCHESTRATION.md` + per-agent slices) artefacts.

When the planner is in three-tier mode the resulting task graph and dependency analysis are written into `framework/templates/ORCHESTRATION.md` (the manifest, sequencing rules, and quality gates) rather than the legacy `PLAN.md` index. The granularity rules, priority bands, and test task rules below are unchanged. See `framework/agents/jdi-planner.md` for the Tier Decision Rule.

---

## Test Task Rules

When test context is provided (test_suite.detected or test_suite.forced), generate test tasks following these rules:

1. **One test task per implementation wave** — covers all auto tasks in that wave
2. **Test task type is `test`** — distinct from `auto` and `checkpoint:*`
3. **Wave placement:** test task wave = implementation wave + 1
4. **Dependencies:** `depends_on` lists all implementation task IDs from the source wave
5. **Agent pin:** always `jdi-qa-tester` with mode `plan-test`
6. **Test derivation:** test cases come from implementation tasks' `done_when` criteria + file-based scope analysis
7. **Full-stack coverage:** if implementation spans multiple layers, tests must cover each layer
8. **Task cap relaxed:** the 2-4 task limit is raised to 2+ (no upper bound) to accommodate auto-generated test tasks alongside implementation tasks
