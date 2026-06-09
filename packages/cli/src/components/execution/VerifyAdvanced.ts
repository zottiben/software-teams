/**
 * VerifyAdvanced component module.
 *
 * Parsing rules applied:
 * - YAML frontmatter provides `name`, `category`, `description`.
 * - Explicit `<section name="X">...</section>` blocks for "Phase" and "Requirements".
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const VerifyAdvanced: Component = {
  name: "VerifyAdvanced",
  category: "execution",
  description:
    "Advanced verification for phase and requirements scope",
  sections: {
    Phase: {
      name: "Phase",
      description: "Phase-level verification steps",
      body: `## Phase Verification

When \`scope="phase"\`:

1. **Verify all plans complete** — Check summary.md exists for each plan, verify success criteria met
2. **Load phase must_haves from roadmap.yaml**
3. **Verify against codebase (not claims)** — Actually check the codebase, run the functionality
4. **Create VERIFICATION.md** with must-haves status table, plans completed, gaps found, human verification needed
5. **Route by status:**
   - \`PASSED\` → Continue to next phase
   - \`GAPS_FOUND\` → Create gap closure plans
   - \`HUMAN_NEEDED\` → Present checklist to user`,
    },
    Requirements: {
      name: "Requirements",
      description: "Requirements-level verification steps",
      body: `## Requirements Verification

When \`scope="requirements"\`:

1. **Load requirements.yaml** — Get all v1 requirements with REQ-IDs
2. **For each requirement** — Find which phase/plan claimed to implement it, verify implementation exists, check acceptance criteria
3. **Cross-reference evidence** — Link to test files, code implementing the requirement, note partial implementations
4. **Generate report** with total/verified/failed/not-implemented counts, verification results table, failed requirements details, recommendations`,
    },
  },
  defaultOrder: ["Phase", "Requirements"],
};

export default VerifyAdvanced;
