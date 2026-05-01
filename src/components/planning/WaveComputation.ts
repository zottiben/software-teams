/**
 * WaveComputation component module.
 *
 * Parsing rules applied:
 * - YAML frontmatter provides `name`, `category`, `description`, and `params`.
 * - `## Heading` boundaries delimit sections.
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const WaveComputation: Component = {
  name: "WaveComputation",
  category: "planning",
  description: "Compute execution waves for parallel plan processing",
  params: [
    {
      name: "plans",
      type: "string",
      required: true,
      description: "Plans to compute waves for",
    },
    {
      name: "output",
      type: "string",
      required: false,
      default: "inline",
      description: "Output format (inline|json)",
    },
  ],
  sections: {
    Algorithm: {
      name: "Algorithm",
      description: "Dependency graph and wave assignment algorithm",
      body: `\`\`\`
1. Build dependency graph:
   For each plan P, for each requirement R in P.requires:
     Find plan Q where Q.provides contains R → edge Q → P

2. Topological sort with wave assignment:
   Wave 1: Plans with no dependencies
   Wave N: Plans whose dependencies are all in waves < N

3. Output wave assignments
\`\`\``,
    },
    Execution: {
      name: "Execution",
      description: "Step-by-step execution of the wave computation",
      body: `### Step 1: Extract Frontmatter

For each plan file, parse \`requires\`, \`provides\`, and current \`wave\` from YAML frontmatter.

### Step 2: Build Dependency Graph

Map which plans depend on which based on requires/provides matching.

### Step 3: Compute Waves

Assign waves based on dependency resolution. Plans in the same wave can execute in parallel.

### Step 4: Output

**Inline**: Update each plan's frontmatter \`wave\` field.
**JSON**: Return wave structure for programmer with wave number, plan IDs, and parallelism flag.`,
    },
    "Cross-Phase Dependencies": {
      name: "Cross-Phase Dependencies",
      description: "How to handle dependencies from previous phases",
      body: `Dependencies from previous phases (\`requires.phase < current\`) are assumed satisfied if that phase is complete. Verify via \`.software-teams/phases/{required-phase}/VERIFICATION.md\`.`,
    },
    "Error Handling": {
      name: "Error Handling",
      description: "How to handle circular dependencies and missing provides",
      body: `- **Circular dependencies**: Report error with cycle path, suggest splitting a plan
- **Missing provides**: Check if cross-phase; if not, report and suggest adding plan`,
    },
  },
  defaultOrder: [
    "Algorithm",
    "Execution",
    "Cross-Phase Dependencies",
    "Error Handling",
  ],
};

export default WaveComputation;
