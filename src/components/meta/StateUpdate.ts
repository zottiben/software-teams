/**
 * StateUpdate component module.
 *
 * Parsing rules applied:
 * - YAML frontmatter provides `name`, `category`, `description`.
 * - `## Heading` boundaries delimit sections.
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const StateUpdate: Component = {
  name: "StateUpdate",
  category: "meta",
  description: "Record decisions, deviations, and blockers in state.yaml",
  sections: {
    "Record Decision": {
      name: "Record Decision",
      description: "Append a decision entry to state.yaml",
      body: `Append to \`decisions\` array in \`state.yaml\`:

\`\`\`yaml
- timestamp: "{ISO}"
  phase: "{phase}"
  decision: "{description}"
  rationale: "{why}"
  impact: "{what it affects}"
\`\`\``,
    },
    "Record Blocker": {
      name: "Record Blocker",
      description: "Append a blocker entry to state.yaml",
      body: `Append to \`blockers\` array in \`state.yaml\`:

\`\`\`yaml
- timestamp: "{ISO}"
  type: "technical|external|decision"
  description: "{what's blocked}"
  impact: "{what can't proceed}"
  resolution: null
\`\`\``,
    },
    "Record Deviation": {
      name: "Record Deviation",
      description: "Append a deviation entry to state.yaml",
      body: `Append to \`deviations\` array in \`state.yaml\`:

\`\`\`yaml
- timestamp: "{ISO}"
  rule: "Rule 1|Rule 2|Rule 3|Rule 4"
  description: "{what deviated}"
  reason: "{why}"
  task: "{task context}"
  files: ["{affected files}"]
\`\`\`

Deviation rules: 1=Auto-fixed bug, 2=Auto-added critical functionality, 3=Auto-fixed blocking issue, 4=Asked about architectural change.`,
    },
  },
  defaultOrder: ["Record Decision", "Record Blocker", "Record Deviation"],
};

export default StateUpdate;
