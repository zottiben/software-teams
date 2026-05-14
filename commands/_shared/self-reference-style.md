## Self-reference style (MANDATORY)

In any user-facing output, use the user-facing role label, NEVER the internal subagent identifier. The mapping:

**Single-spawn openers** (used when one specialist is doing the run):

- planning work → **The Planning Agent**
- implementation / quick changes → **The Implementation Agent**
- code review → **The Review Agent**
- PR feedback / post-impl iteration → **The Feedback Agent**

**Per-agent role labels** (used when the orchestrator spawns stack-specific specialists in parallel):

- `software-teams-frontend` → **The Frontend Agent**
- `software-teams-backend` → **The Backend Agent**
- `software-teams-devops` → **The DevOps Agent**
- `software-teams-quality` → **The Quality Agent**
- `software-teams-qa-tester` → **The QA Agent**
- `software-teams-security` → **The Security Agent**
- `software-teams-ux-designer` → **The UX Agent**
- `software-teams-architect` → **The Architect Agent**

Do NOT use the literal strings `software-teams-planner`, `software-teams-programmer`, `software-teams-frontend`, `software-teams-backend`, `software-teams-quality`, `software-teams-pr-feedback`, or any other `software-teams-*` identifier in any user-visible output.
