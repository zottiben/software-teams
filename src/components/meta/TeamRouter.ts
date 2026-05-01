/**
 * TeamRouter component module.
 *
 * Parsing rules applied:
 * - YAML frontmatter provides `name`, `category`, `description`, and `params`.
 * - `## Heading` boundaries delimit sections for most content.
 * - Explicit `<section name="X">...</section>` blocks for "MemberActivation",
 *   "ResumeRouting", and "CollaborationPatterns".
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 * - Trailing `(...)` parameter hints stripped from heading text (none present here).
 */

import type { Component } from "../types";

const TeamRouter: Component = {
  name: "TeamRouter",
  category: "meta",
  description: "Resolve which team(s) to spawn for a given command",
  params: [
    {
      name: "command",
      type: "string",
      required: false,
      description: "Command to route (e.g. create-plan, implement-plan)",
    },
  ],
  sections: {
    RoutingTable: {
      name: "RoutingTable",
      description: "Maps commands to teams, patterns, and agent loop flags",
      body: `| Command | Primary Team | Supporting | Pattern | Agent Loop |
|---------|-------------|------------|---------|------------|
| \`create-plan\` | Product & Research | — | Sequential | Yes |
| \`implement-plan\` | Engineering | Micro-Management | Parallel (oversight) | Yes |
| \`research-phase\` | Product & Research | — | Sequential | Yes |
| \`pr-feedback\` | Engineering | — | Sequential | Yes |
| \`pr-review\` | QA | Engineering | Parallel (context) | Yes |
| \`commit\` | Engineering | — | Direct | No |
| \`generate-pr\` | Engineering | — | Direct | No |
| \`map-codebase\` | Product & Research | — | Sequential | Yes |
| \`resume\` | (from state) | (from state) | Resumes previous | Yes |`,
    },
    TeamSpecs: {
      name: "TeamSpecs",
      description: "Paths to team spec files",
      body: `| Team | Path |
|------|------|
| Engineering | \`.software-teams/framework/teams/engineering.md\` |
| Product & Research | \`.software-teams/framework/teams/product-research.md\` |
| Quality Assurance | \`.software-teams/framework/teams/quality-assurance.md\` |
| DevOps | \`.software-teams/framework/teams/devops.md\` |
| Micro-Management | \`.software-teams/framework/teams/micro-management.md\` |`,
    },
    ResolutionAlgorithm: {
      name: "ResolutionAlgorithm",
      description: "Steps to resolve team and pattern for a given command",
      body: `1. Strip \`/st:\` prefix, normalise command
2. Look up in routing table (skill names map to same command)
3. Resolve primary + supporting team specs
4. Determine collaboration pattern and agent loop flag
5. Activate members based on task context`,
    },
    MemberActivation: {
      name: "MemberActivation",
      description: "Which team members to activate based on file types in the task",
      body: `## Member Activation

Activate members based on file types in the task:

| Context | Detection | Active Members |
|---------|-----------|----------------|
| Backend | \`.php\` files | software-teams-backend |
| Frontend | \`.tsx\`/\`.ts\` files | software-teams-frontend |
| Full-stack | Both PHP + TS | software-teams-backend, software-teams-frontend, software-teams-programmer |
| Commit | Any | software-teams-committer |
| PR generation | Any | software-teams-pr-generator |
| Plan creation | — | software-teams-planner, software-teams-product-lead |
| Research | — | software-teams-researcher, software-teams-planner |
| PR review | — | software-teams-quality, software-teams-verifier |
| Oversight | During implementation | software-teams-head-engineering, software-teams-product-lead |`,
    },
    ResumeRouting: {
      name: "ResumeRouting",
      description: "How to route resume commands from state",
      body: `## Resume Routing

1. Read \`.software-teams/config/state.yaml\`
2. Map status: planning→create-plan, executing→implement-plan, verifying→pr-review
3. Route as resolved command with \`resume=true, resume_from_task={position.task}\``,
    },
    CollaborationPatterns: {
      name: "CollaborationPatterns",
      description: "Descriptions of each collaboration pattern used by the routing table",
      body: `## Collaboration Patterns

| Pattern | Used By | Description |
|---------|---------|-------------|
| Sequential | create-plan, research-phase, pr-feedback, map-codebase | Primary team executes, writes state, next team reads state to continue |
| Parallel (Oversight) | implement-plan | Engineering executes tasks; Micro-Management monitors state.yaml, flags concerns |
| Parallel (Context) | pr-review | QA reviews code; Engineering provides context and addresses findings |
| Direct | commit, generate-pr | Single agent, single Task invocation, no team coordination |`,
    },
  },
  defaultOrder: [
    "RoutingTable",
    "TeamSpecs",
    "ResolutionAlgorithm",
    "MemberActivation",
    "ResumeRouting",
    "CollaborationPatterns",
  ],
};

export default TeamRouter;
