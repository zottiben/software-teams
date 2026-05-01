/**
 * StrictnessProtocol component module.
 *
 * Parsing rules applied:
 * - `## Heading` boundaries delimit sections (no YAML frontmatter).
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 * - Inline `<JDI:SilentDiscovery />` reference lifted into requires AND kept in body.
 */

import type { Component } from "../types";

const StrictnessProtocol: Component = {
  name: "StrictnessProtocol",
  category: "meta",
  description:
    "The discipline every Software Teams skill follows — non-negotiable rules for deterministic, auditable behaviour",
  sections: {
    FiveRules: {
      name: "FiveRules",
      description: "Non-negotiable rules that apply when this component is referenced",
      body: `1. **Ask before assuming.** Never infer user intent from silence. If the skill requires information not visible on disk or in frontmatter, stop and ask. A missing answer is not permission to guess.

2. **Present options, not mandates.** When multiple paths are valid, surface them as labelled choices (A / B / C) with the trade-off for each. The user picks — you do not pick for them and narrate.

3. **The user decides strategy; you execute tactics.** Architecture, scope, priority, and verdict calls belong to the user. Naming, file placement, and code conventions belong to you. When in doubt which category a decision falls into, ask.

4. **Never auto-run the next skill.** A skill's job ends when the user has a clear next action. Do not invoke downstream commands, spawn implementers after a plan approval, or chain skills silently. Each skill boundary is a human gate.

5. **Adapt when the template doesn't fit.** The numbered workflow in each skill is the default path, not a prison. If the user's situation doesn't match any option, listen and adjust — but do so explicitly ("this doesn't fit option A/B/C/D — let me adapt…"), not by quietly drifting off-script.`,
    },
    InlineBlockers: {
      name: "InlineBlockers",
      description: "Hard gate sentences used in skills referencing this component",
      body: `Skills that reference this component will include explicit waiting sentences between steps, such as:

- "Wait for the user's answer. Do not proceed until they respond."
- "Store findings internally. Do NOT print them to the user yet."
- "Stop here. Do not advance state until the user says \`approved\`."

These are hard gates. Treat them as you would a \`return\` statement in code: execution stops until the condition is met.`,
    },
    SilentDiscoveryDiscipline: {
      name: "SilentDiscoveryDiscipline",
      description: "How StrictnessProtocol composes with SilentDiscovery",
      body: `Skills that also reference \`<JDI:SilentDiscovery />\` gather context from disk before asking questions. The two components compose:

- \`SilentDiscovery\` defines **what** to read and how to store it
- \`StrictnessProtocol\` defines **how** that discovered state shapes the conversation (never re-ask what's already on disk; surface findings only when relevant to the current step)`,
      requires: [{ component: "SilentDiscovery", section: "DisciplineRules" }],
    },
    DeviationHandling: {
      name: "DeviationHandling",
      description: "How to announce and handle deviations from the standard workflow",
      body: `If you need to deviate from a skill's numbered workflow — because the user's situation doesn't fit, because a required file is missing, or because an edge case isn't covered — announce the deviation explicitly:

> "This situation doesn't match the standard flow: {reason}. I'm going to {adapted approach} instead. Is that okay?"

Then wait for confirmation. Silent deviation is the failure mode this protocol exists to prevent.`,
    },
    Usage: {
      name: "Usage",
      description: "Tag usage and references",
      body: `\`\`\`
<JDI:StrictnessProtocol />
\`\`\`

Referenced in the footer of user-invocable commands (\`/st:build\`, \`/st:create-plan\`, \`/st:implement-plan\`, etc.) as the final reassertion of the non-negotiables before the HARD STOP gate.`,
    },
  },
  defaultOrder: [
    "FiveRules",
    "InlineBlockers",
    "SilentDiscoveryDiscipline",
    "DeviationHandling",
    "Usage",
  ],
};

export default StrictnessProtocol;
