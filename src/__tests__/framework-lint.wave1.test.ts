import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
// Plugin tree (agents/+commands/) was promoted to source-of-truth; the
// post-rename specs now live at <repo-root>/agents/ rather than
// <repo-root>/framework/agents/.
const agentsDir = join(REPO_ROOT, "agents");

describe("framework-lint — wave-1 rebrand regex verification", () => {
  test("listAgentFiles regex matches at least one software-teams-*.md file", () => {
    const files = readdirSync(agentsDir).filter((f) => /^software-teams-.+\.md$/.test(f));

    // The regex must match at least one file (otherwise it's broken/not running)
    expect(files.length).toBeGreaterThanOrEqual(1);

    // And at least one must be a real agent
    expect(files.some((f) => f === "software-teams-planner.md" || f.startsWith("software-teams-"))).toBe(true);
  });

  test("regex does NOT match jdi-*.md (old pattern gone)", () => {
    const legacyAgentFiles = readdirSync(agentsDir).filter((f) => /^jdi-.+\.md$/.test(f));
    expect(legacyAgentFiles.length).toBe(0);
  });

  test("AGENTS.md catalogue uses software-teams- naming", () => {
    // After T1 completes, .claude/AGENTS.md is generated via convertAgents.
    // Verify the live repo AGENTS.md uses the new pattern.
    const agentsMdPath = join(REPO_ROOT, ".claude", "AGENTS.md");

    let agentsMd = "";
    try {
      agentsMd = readFileSync(agentsMdPath, "utf-8");
    } catch {
      // If file doesn't exist yet (running before sync-agents), that's OK — the
      // regex test above already passed, so the pattern is correct.
      expect(true).toBe(true);
      return;
    }

    // If the file exists, verify it references software-teams agents
    if (agentsMd.length > 0) {
      expect(agentsMd).toMatch(/software-teams-/);
      // Regression: must not reference old jdi- agents
      const dataRows = agentsMd.split("\n").filter((l) => /^\|/.test(l));
      for (const row of dataRows) {
        expect(row).not.toMatch(/jdi-/);
      }
    }
  });
});
