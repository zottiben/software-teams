---
name: TeamRouter
category: meta
description: Resolve which team(s) to spawn for a given command
params:
  - { name: command, type: string, required: false, description: "Command to route (e.g. create-plan, implement-plan)" }
---

# TeamRouter

## Routing Table

| Command | Primary Team | Supporting | Pattern | Agent Loop |
|---------|-------------|------------|---------|------------|
| `create-plan` | Product & Research | — | Sequential | Yes |
| `implement-plan` | Engineering | Micro-Management | Parallel (oversight) | Yes |
| `research-phase` | Product & Research | — | Sequential | Yes |
| `pr-feedback` | Engineering | — | Sequential | Yes |
| `pr-review` | QA | Engineering | Parallel (context) | Yes |
| `commit` | Engineering | — | Direct | No |
| `generate-pr` | Engineering | — | Direct | No |
| `map-codebase` | Product & Research | — | Sequential | Yes |
| `resume` | (from state) | (from state) | Resumes previous | Yes |

## Team Specs

| Team | Path |
|------|------|
| Engineering | `.jdi/framework/teams/engineering.md` |
| Product & Research | `.jdi/framework/teams/product-research.md` |
| Quality Assurance | `.jdi/framework/teams/quality-assurance.md` |
| DevOps | `.jdi/framework/teams/devops.md` |
| Micro-Management | `.jdi/framework/teams/micro-management.md` |

## Resolution Algorithm

1. Strip `/jdi:` prefix, normalise command
2. Look up in routing table (skill names map to same command)
3. Resolve primary + supporting team specs
4. Determine collaboration pattern and agent loop flag
5. Activate members based on task context

---

<section name="MemberActivation">

## Member Activation

Activate members based on file types in the task:

| Context | Detection | Active Members |
|---------|-----------|----------------|
| Backend | `.php` files | jdi-backend |
| Frontend | `.tsx`/`.ts` files | jdi-frontend |
| Full-stack | Both PHP + TS | jdi-backend, jdi-frontend, jdi-executor |
| Commit | Any | jdi-committer |
| PR generation | Any | jdi-pr-generator |
| Plan creation | — | jdi-planner, jdi-product-lead |
| Research | — | jdi-researcher, jdi-planner |
| PR review | — | jdi-quality, jdi-verifier |
| Oversight | During implementation | jdi-head-engineering, jdi-product-lead |

</section>

<section name="ResumeRouting">

## Resume Routing

1. Read `.jdi/config/state.yaml`
2. Map status: planning→create-plan, executing→implement-plan, verifying→pr-review
3. Route as resolved command with `resume=true, resume_from_task={position.task}`

</section>

<section name="CollaborationPatterns">

## Collaboration Patterns

| Pattern | Used By | Description |
|---------|---------|-------------|
| Sequential | create-plan, research-phase, pr-feedback, map-codebase | Primary team executes, writes state, next team reads state to continue |
| Parallel (Oversight) | implement-plan | Engineering executes tasks; Micro-Management monitors state.yaml, flags concerns |
| Parallel (Context) | pr-review | QA reviews code; Engineering provides context and addresses findings |
| Direct | commit, generate-pr | Single agent, single Task invocation, no team coordination |

</section>
