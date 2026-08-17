import { describe, expect, test } from "bun:test";
import { SoftwareTeamsClaudeCode } from "../SoftwareTeamsClaudeCode.node";

describe("SoftwareTeamsClaudeCode node", () => {
  const node = new SoftwareTeamsClaudeCode();

  test("is the generic one-turn composition primitive", () => {
    expect(node.description.name).toBe("softwareTeamsClaudeCode");
    expect(node.description.inputs).toEqual(["main"]);
    expect(node.description.outputs).toEqual(["main"]);
    expect(node.description.usableAsTool).toBeTrue();
  });

  test("exposes every specialist through one agent parameter", () => {
    const agent = node.description.properties.find((property) => property.name === "agentId");
    expect(agent?.type).toBe("options");
    const options = Array.isArray(agent?.options) ? agent.options : [];
    const values = options.map((option) => ("value" in option ? option.value : undefined));
    expect(values).toContain("software-teams-support-triage");
    expect(values).toContain("software-teams-programmer");
    expect(new Set(values).size).toBe(values.length);
  });

  test("defaults to read-only tools and dontAsk is not operator-overridable", () => {
    const tools = node.description.properties.find((property) => property.name === "toolPolicy");
    expect(tools?.default).toBe("readOnly");
    expect(node.description.properties.some((property) => property.name === "permissionMode"))
      .toBeFalse();
    expect(node.description.description).toContain("dontAsk");
  });

  test("supports workflow-specific JSON schemas", () => {
    const mode = node.description.properties.find((property) => property.name === "schemaMode");
    const schema = node.description.properties.find((property) => property.name === "outputSchema");
    expect(mode?.default).toBe("turn");
    expect(schema?.displayOptions?.show?.schemaMode).toEqual(["custom"]);
  });

  test("has unattended turn caps and cumulative ticket budget support", () => {
    expect(
      node.description.properties.find((property) => property.name === "maxTurns")?.default,
    ).toBe(8);
    expect(
      node.description.properties.find((property) => property.name === "maxTurnBudgetUsd")
        ?.default,
    ).toBe(0);
    expect(node.description.description).toContain("ticket budget");
  });
});
