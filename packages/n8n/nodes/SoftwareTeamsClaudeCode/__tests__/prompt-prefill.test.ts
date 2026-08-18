import { describe, test, expect } from "bun:test";
import type { INodeProperties } from "n8n-workflow";
import { SoftwareTeamsClaudeCode } from "../SoftwareTeamsClaudeCode.node";
import { SoftwareTeamsAgent } from "../../SoftwareTeamsAgent/SoftwareTeamsAgent.node";
import { SPECIALISTS } from "../../../src/execution/specialists";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { N8N_MODEL_OPTIONS } = require("@websitelabs/software-teams") as {
  N8N_MODEL_OPTIONS: Array<{ name: string; value: string }>;
};

function promptProps(properties: INodeProperties[]): INodeProperties[] {
  return properties.filter((p) => p.name === "prompt");
}

describe.each([
  ["Claude Code", new SoftwareTeamsClaudeCode(), "agentId"],
  ["Agent", new SoftwareTeamsAgent(), "specialist"],
])("%s node prefills Prompt per agent", (_label, node, selector) => {
  const props = promptProps(node.description.properties as INodeProperties[]);

  test("declares one Prompt per specialist", () => {
    expect(props).toHaveLength(SPECIALISTS.length);
  });

  test("each Prompt is shown for exactly one agent and defaults to that agent's text", () => {
    for (const specialist of SPECIALISTS) {
      const shown = props.filter((p) => {
        const values = (p.displayOptions?.show as Record<string, unknown[]> | undefined)?.[selector];
        return Array.isArray(values) && values.includes(specialist.value);
      });
      expect(shown).toHaveLength(1);
      expect(shown[0]!.default).toBe(specialist.defaultPrompt);
    }
  });

  test("no Prompt is left visible for every agent", () => {
    // A definition without displayOptions would shadow the per-agent ones and
    // silently restore a single generic default.
    expect(props.every((p) => p.displayOptions?.show)).toBe(true);
  });

  test("the subtitle surfaces the resolved prompt, not just the agent", () => {
    expect(node.description.subtitle).toContain('$parameter["prompt"]');
  });
});

describe("model catalogue", () => {
  test("offers the interim Opus and Sonnet releases", () => {
    const values = N8N_MODEL_OPTIONS.map((o) => o.value);
    expect(values).toContain("claude-opus-4-8");
    expect(values).toContain("claude-opus-4-7");
    expect(values).toContain("claude-opus-4-6");
    expect(values).toContain("claude-sonnet-4-6");
  });

  test("still leads with the aliases", () => {
    const values = N8N_MODEL_OPTIONS.map((o) => o.value);
    for (const alias of ["sonnet", "opus", "haiku", "fable"]) {
      expect(values).toContain(alias);
    }
  });

  test("lists every model exactly once", () => {
    const values = N8N_MODEL_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
