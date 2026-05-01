---
name: Verify
category: execution
description: Verify completion of tasks, plans, phases, or requirements
params:
  - name: scope
    type: string
    required: false
    options: ["task", "plan", "phase", "requirements"]
    default: "task"
    description: What level to verify
  - name: strict
    type: boolean
    required: false
    default: false
    description: Fail on any unmet criteria (vs warn)
  - name: include_tests
    type: boolean
    required: false
    default: true
    description: Run tests as part of verification
---

# Verify

Verify completion of work at various levels of granularity.

---

## Default Behaviour

When invoked as `@ST:Verify`:

1. **Determine scope** — Check current position from state.yaml, default to task-level
2. **Load verification criteria** — task: PLAN.md verification section; plan: PLAN.md success_criteria; phase: ROADMAP.yaml must_haves
3. **Execute verification** — Run each check, record pass/fail
4. **Report results** — Output summary, update state

---

<section name="Task">

## Task Verification (`scope="task"`)

1. **Load task verification criteria** from PLAN.md `**Verification:**` checklist
2. **Execute each check**: file existence, code patterns, test gates (see TestRunner), manual inspection
3. **Load done criteria** from `**Done when:**`
4. **Report result**:
   ```markdown
   ## Task Verification: Task {N}
   **Status:** PASS | FAIL

   ### Verification Checks
   - [x] {check 1} - PASS
   - [ ] {check 2} - FAIL: {reason}

   ### Done Criteria
   - [x] {criterion} - Met

   ### Issues
   - {issue description if any}
   ```

</section>

---

<section name="Plan">

## Plan Verification (`scope="plan"`)

1. **Verify all tasks complete** — check status and commits
2. **Load plan success criteria** from `<success_criteria>` block
3. **Execute plan-level checks** — test suite, lint/type errors, integration points
4. **Generate SUMMARY.md preview** — draft with deviations
5. **Report result**:
   ```markdown
   ## Plan Verification: {phase}-{plan}
   **Status:** PASS | FAIL

   ### Task Completion
   - [x] Task 1: {name} - {commit}

   ### Success Criteria
   - [x] {criterion 1} - Met
   - [ ] {criterion 2} - NOT MET: {reason}

   ### Tests
   - Suite: {test suite} | Result: {pass/fail} | Coverage: {percentage}

   ### Ready for SUMMARY.md: YES | NO
   ```

</section>

---

## Advanced Verification (Phase & Requirements)

For `scope="phase"` or `scope="requirements"`, load `@ST:VerifyAdvanced`.

---

<section name="TestRunner">

## Test Execution (`include_tests="true"`)

1. **Detect changed files**
   ```bash
   # Task-level
   git diff --cached --name-only
   git diff --name-only
   # Plan-level
   git diff master --name-only
   ```

2. **Backend test gate (MANDATORY if ANY `*.php` files changed)**
   ```bash
   composer test
   ```
   If fails: verification FAILS. Do not proceed. Fix tests first.

3. **Frontend tests (if `*.ts`, `*.tsx`, `*.js`, `*.jsx` changed)**
   ```bash
   bun run test:vitest
   ```

4. **Parse results** — total, passed, failed, skipped, coverage

5. **Report**: For each stack (Backend/Frontend), include: ran (yes/no), command, result, counts, and any failed test details.

</section>

---

## State Updates

After verification, set `position.status` to `verified` or `verification_failed`. If gaps found, add to `blockers` array with `type: verification_gap`.

Gap severity: Critical (goal blocked → closure plan), High (requirement unmet → targeted fix), Medium (partially met → note), Low (enhancement → document).
