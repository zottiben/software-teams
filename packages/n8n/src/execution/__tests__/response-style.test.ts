import { describe, test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAgentDefinition } from "../agent-definition";
import { SPECIALIST_OPTIONS } from "../specialists";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { STE_RESPONSE_STYLE } = require("@websitelabs/software-teams") as {
  STE_RESPONSE_STYLE: string;
};

const CLI_ROOT = join(import.meta.dir, "../../../../cli");
const AGENTS_DIR = join(CLI_ROOT, "agents");

function allAgentIds(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.startsWith("software-teams-") && f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

describe("Simplified Technical English reaches every n8n turn", () => {
  test("every bundled specialist prompt ends with the style block", () => {
    // Central injection is the point: a spec author cannot forget it, and a new
    // specialist inherits it without an edit.
    for (const agentId of allAgentIds()) {
      const definition = buildAgentDefinition({
        agentId,
        baseDir: CLI_ROOT,
        structuredOutput: true,
      });
      expect(definition).not.toBeNull();
      expect(definition!.prompt).toContain(STE_RESPONSE_STYLE);
      expect(definition!.prompt.trimEnd().endsWith(STE_RESPONSE_STYLE)).toBe(true);
    }
  });

  test("covers every agent the node dropdowns offer", () => {
    for (const { value } of SPECIALIST_OPTIONS) {
      const definition = buildAgentDefinition({
        agentId: value,
        baseDir: CLI_ROOT,
        structuredOutput: true,
      });
      expect(definition!.prompt).toContain("Simplified Technical English");
    }
  });

  test("the specialist's own instructions still come first", () => {
    const definition = buildAgentDefinition({
      agentId: "software-teams-support-triage",
      baseDir: CLI_ROOT,
      structuredOutput: true,
    });
    const prompt = definition!.prompt;
    expect(prompt.indexOf("triage")).toBeLessThan(prompt.indexOf(STE_RESPONSE_STYLE));
  });

  test("is added exactly once", () => {
    const definition = buildAgentDefinition({
      agentId: "software-teams-programmer",
      baseDir: CLI_ROOT,
      structuredOutput: true,
    });
    expect(definition!.prompt.split("## Response language")).toHaveLength(2);
  });
});

describe("the style block itself", () => {
  test("protects evidence from being simplified", () => {
    // An agent that rewrites an identifier or a log line has destroyed the
    // thing it was asked to report. This carve-out is the load-bearing part.
    expect(STE_RESPONSE_STYLE).toContain("Never simplify evidence");
    expect(STE_RESPONSE_STYLE).toMatch(/identifiers, code, commands, file paths/);
  });

  test("states the sentence-length limits", () => {
    expect(STE_RESPONSE_STYLE).toContain("20 words");
    expect(STE_RESPONSE_STYLE).toContain("25");
  });

  test("claims the writing rules, not dictionary conformance", () => {
    expect(STE_RESPONSE_STYLE).toContain("ASD-STE100 writing rules");
  });
});
