# Testing Learnings

<!-- Rules extracted from PR reviews about testing patterns, quality standards, and test conventions -->

## Test Plan Patterns

### When Test Tasks Are Generated

Test tasks are added to a plan when:
- SilentDiscovery detects a test suite in the project (`.test.*`, `.spec.*`, test runner config)
- The user explicitly passes `--with-tests` to `/jdi:create-plan`

Test tasks are NOT generated when:
- The user passes `--without-tests`
- The plan contains only documentation or config changes (no code changes to test)

### How Test Cases Are Derived

jdi-planner derives test cases from the `done_when` criteria of the implementation tasks the test task `depends_on`. Each `done_when` criterion becomes one or more test cases covering:
- The happy path (criterion is met)
- Edge cases and boundary conditions
- Error paths (criterion violation)

### Full-Stack Coverage Expectations

When `test_scope` includes multiple layers (unit, integration, component, e2e), the test agent writes **separate test files per layer**. Backend and frontend tests are never bundled into one file.

Coverage layers:
- `unit` — individual functions/modules in isolation
- `integration` — interactions between modules, API endpoints with real handlers
- `component` — UI components with their props/state
- `e2e` — user flows end-to-end (only if e2e framework detected)

### Test File Naming Conventions

Always match the project's existing test file patterns:
- Co-located: `src/utils/foo.test.ts` alongside `src/utils/foo.ts`
- Separate directory: `tests/unit/foo.test.ts` or `__tests__/foo.test.ts`
- Mirror the extension: `.test.ts`, `.spec.ts`, `.test.tsx`, etc.

### The plan-test Workflow

1. jdi-planner generates a `type: test` task with `test_scope`, `test_framework`, and `test_command` in its frontmatter
2. implement-plan routes `type: test` tasks to `jdi-qa-tester` in `plan-test` mode (overriding normal agent resolution)
3. jdi-qa-tester reads the task file's test cases, reads `depends_on` tasks for context, writes test files, and runs them
4. `post-task-verify` is skipped for test tasks — the test run IS the verification
5. Test failures are S2 severity: the plan halts and the user is asked to resolve

### Common Pitfalls

- Do NOT generate test tasks for documentation-only or config-only plans
- Do NOT bundle multiple layers into a single test file
- Do NOT assume a test framework — always use what SilentDiscovery detected
- Do NOT skip the test run — writing tests without running them has no value
- Do NOT place test files in locations that break the project's existing convention
