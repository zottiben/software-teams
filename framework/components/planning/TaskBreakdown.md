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
<task id="{N}" type="auto|checkpoint:*" tdd="true|false" wave="{W}">

## Task {N}: {Name}

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

Task types: `auto` (execute without stopping), `checkpoint:human-verify`, `checkpoint:decision`, `checkpoint:human-action`

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
