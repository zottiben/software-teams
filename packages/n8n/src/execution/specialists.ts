/**
 * The specialists offered by the n8n node dropdowns.
 *
 * Deliberately narrower than `packages/cli/agents/`: the plugin ships every
 * specialist for interactive `/st:*` use, while a workflow canvas only benefits
 * from the ones that make sense as an unattended single turn. Adding a spec
 * does not add it here.
 *
 * Each entry carries a default task prompt. n8n resolves a parameter's default
 * from the definition whose `displayOptions` currently match, so one Prompt
 * property per agent is what makes the field prefill on selection. The pattern
 * is the same one n8n's own ClickUp node uses to vary `operation` per resource.
 */
export interface Specialist {
  /** Dropdown label. */
  readonly name: string;
  /** Agent id, matching a file in `packages/cli/agents/`. */
  readonly value: string;
  /** Prefilled Prompt for this agent, used until an operator edits it. */
  readonly defaultPrompt: string;
}

/** The upstream task, interpolated into every default. */
const UPSTREAM_TASK = "{{ $json.input.prompt }}";

/**
 * Build a default Prompt.
 *
 * The leading `=` is what marks the value as an n8n expression; without it the
 * `{{ }}` is inert text and the agent receives the literal braces.
 */
function prefilled(instruction: string): string {
  return `=${instruction}\n\n${UPSTREAM_TASK}`;
}

export const SPECIALISTS: readonly Specialist[] = [
  {
    name: "Backend Engineer",
    value: "software-teams-backend",
    defaultPrompt: prefilled(
      "Implement the backend work described below: API surface, data layer, and " +
      "server-side behaviour. Follow the existing patterns in this codebase rather " +
      "than introducing new ones.",
    ),
  },
  {
    name: "Codebase Mapper",
    value: "software-teams-codebase-mapper",
    defaultPrompt: prefilled(
      "Map the areas of this codebase relevant to the task below: the modules " +
      "involved, how they call each other, and the patterns and constraints a " +
      "change here has to respect. Report structure, not opinions.",
    ),
  },
  {
    name: "Feedback Learner",
    value: "software-teams-feedback-learner",
    defaultPrompt: prefilled(
      "Read the review comments below and extract the durable rules behind them. " +
      "Skip anything already documented in the project's rules files, and state " +
      "each new rule as guidance a future change can be checked against.",
    ),
  },
  {
    name: "Frontend Engineer",
    value: "software-teams-frontend",
    defaultPrompt: prefilled(
      "Implement the frontend work described below: components, state, and " +
      "client-side behaviour. Match the surrounding code's conventions and keep " +
      "the change scoped to what was asked.",
    ),
  },
  {
    name: "Planner",
    value: "software-teams-planner",
    defaultPrompt: prefilled(
      "Break the work below into an executable plan: tasks, dependencies between " +
      "them, and what done looks like for each. Use S/M/L sizing, never time " +
      "estimates. Do not implement anything.",
    ),
  },
  {
    name: "PR Feedback",
    value: "software-teams-pr-feedback",
    defaultPrompt: prefilled(
      "Address the pull request review comments below. Make the code change each " +
      "one calls for, and say plainly where you disagree rather than silently " +
      "skipping a comment.",
    ),
  },
  {
    name: "PR Generator",
    value: "software-teams-pr-generator",
    defaultPrompt: prefilled(
      "Write the pull request description for the change below: what changed, why, " +
      "and what a reviewer should look at first. Describe only what the diff " +
      "actually does.",
    ),
  },
  {
    name: "Programmer",
    value: "software-teams-programmer",
    defaultPrompt: prefilled(
      "Carry out the task below. Keep the diff scoped to what was asked, match the " +
      "surrounding code, and report any deviation you had to make rather than " +
      "absorbing it silently.",
    ),
  },
  {
    name: "QA Tester",
    value: "software-teams-qa-tester",
    defaultPrompt: prefilled(
      "Write the test cases and regression checks for the change below, then run " +
      "what already exists. Report failures with their actual output; never report " +
      "a suite as passing without having run it.",
    ),
  },
  {
    name: "Researcher",
    value: "software-teams-researcher",
    defaultPrompt: prefilled(
      "Research the question below and report findings with sources. Separate what " +
      "you verified from what you inferred, and say explicitly what you could not " +
      "establish.",
    ),
  },
  {
    name: "Support Triage",
    value: "software-teams-support-triage",
    defaultPrompt: prefilled(
      "Triage the support ticket below. Establish what actually happened, how often, " +
      "and what the evidence is, then recommend the next safe action. Investigate " +
      "only: change no customer or production state.",
    ),
  },
  {
    name: "Verifier",
    value: "software-teams-verifier",
    defaultPrompt: prefilled(
      "Verify the work below against its stated goal, working backwards from what " +
      "was asked to what was actually produced. Check the artifacts themselves " +
      "rather than the claims about them, and report every gap you find.",
    ),
  },
];

/** One UI catalogue shared by the specialist and generic Claude Code nodes. */
export const SPECIALIST_OPTIONS: ReadonlyArray<{ readonly name: string; readonly value: string }> =
  SPECIALISTS.map(({ name, value }) => ({ name, value }));

/** Agent selected when a node is dropped on the canvas. */
export const DEFAULT_SPECIALIST = "software-teams-support-triage";

/** The default Prompt for one agent, or the bare upstream expression if unknown. */
export function defaultPromptFor(agentId: string): string {
  return SPECIALISTS.find((s) => s.value === agentId)?.defaultPrompt ?? `=${UPSTREAM_TASK}`;
}
