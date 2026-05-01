/**
 * CodebaseContext component module.
 *
 * Parsing rules applied:
 * - `## Heading` boundaries delimit sections (no YAML frontmatter).
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const CodebaseContext: Component = {
  name: "CodebaseContext",
  category: "execution",
  description:
    "Cache-first codebase context loading — reads existing analysis, never spawns mapper automatically",
  sections: {
    CacheFirstLoading: {
      name: "CacheFirstLoading",
      description: "Rules for loading codebase context from cache",
      body: `1. If \`.software-teams/codebase/summary.md\` exists → **read it directly** (regardless of age)
2. If \`.software-teams/codebase/CONVENTIONS.md\` exists → read it when writing code
3. If neither exists → **inform user** to run \`/st:map-codebase\` first, then proceed without codebase context

**Never spawn codebase mapper automatically.** The mapper is expensive (~30% of session budget). Only run it via explicit \`/st:map-codebase\` command.

**Skip entirely if:** \`--skip-codebase\` flag is present in command arguments.`,
    },
    ContextFiles: {
      name: "ContextFiles",
      description: "Which files to read and when",
      body: `| File | Purpose | When to Read |
|------|---------|--------------|
| \`.software-teams/codebase/summary.md\` | Architecture overview, file locations, tech stack | Always (if exists) |
| \`.software-teams/codebase/CONVENTIONS.md\` | Coding standards (mapper output only) | When writing code (if exists) |
| \`.claude/rules/*.md\` | Auto-loaded patterns (no explicit read needed) | Automatic |
| \`.software-teams/config/state.yaml\` | Current phase, plan, position | Always |`,
    },
    UsageInCommands: {
      name: "UsageInCommands",
      description: "Tag usage",
      body: `\`\`\`
@ST:CodebaseContext
\`\`\`

This component reads cached context files. If no codebase analysis exists, it proceeds without it — agents can still analyse relevant source files directly.`,
    },
  },
  defaultOrder: ["CacheFirstLoading", "ContextFiles", "UsageInCommands"],
};

export default CodebaseContext;
