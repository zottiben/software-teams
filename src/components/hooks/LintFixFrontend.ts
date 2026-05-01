/**
 * LintFixFrontend hook component (Phase C migration).
 * Source: hooks/lint-fix-frontend.md
 */

import type { Component } from "../types";

const LintFixFrontend: Component = {
  name: "LintFixFrontend",
  category: "hooks",
  description: "Auto-fix ESLint issues on frontend files after edit",
  sections: {
    Default: {
      name: "Default",
      description: "LintFixFrontend default body",
      body: `# Lint Fix Frontend Hook

Automatically runs \`bun run lint:fix\` after Claude Code (or an agent) edits or writes a file.

---

## Trigger

Fires when:
- Claude Code edits a file (Edit tool)
- Claude Code writes a file (Write tool)
- Any Software Teams agent edits/writes files via subagents

**Claude Code event:** \`PostToolUse\` with matcher \`Edit|Write\`

---

## Behaviour

Runs \`bun run lint:fix\` (\`turbo lint -- --fix\`) asynchronously in the background so Claude is not blocked. Covers all frontend workspaces via turbo.

---

## Installation

Registered automatically by \`/st:init\` in \`.claude/settings.local.json\`:

\`\`\`json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun run lint:fix",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ]
  }
}
\`\`\`

---

## Manual Override

To temporarily disable, remove the \`PostToolUse\` entry from \`.claude/settings.local.json\`.`,
    },
  },
  defaultOrder: ["Default"],
};

export default LintFixFrontend;
