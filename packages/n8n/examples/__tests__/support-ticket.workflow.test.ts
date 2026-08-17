import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WorkflowNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
}

interface Workflow {
  name: string;
  active: boolean;
  nodes: WorkflowNode[];
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
}

const workflow = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "support-ticket.workflow.json"), "utf8"),
) as Workflow;

function node(name: string): WorkflowNode {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing workflow node ${name}`);
  return found;
}

describe("support-ticket.workflow.json", () => {
  test("ships inactive so importing it cannot consume a live support queue", () => {
    expect(workflow.active).toBeFalse();
    expect(workflow.name).toContain("Support Ticket");
  });

  test("manual and tagged ClickUp entry converge on the same triage node", () => {
    expect(node("Manual Ticket").type).toBe(
      "@websitelabs/n8n-nodes-software-teams.softwareTeamsTicket",
    );
    expect(node("Tagged ClickUp Tickets").type).toBe(
      "@websitelabs/n8n-nodes-software-teams.softwareTeamsClickUpTrigger",
    );
    expect(workflow.connections["Manual Ticket"]?.main[0]?.[0]?.node).toBe("Triage");
    expect(workflow.connections["Tagged ClickUp Tickets"]?.main[0]?.[0]?.node).toBe("Triage");
  });

  test("uses NDP-34603 as the deferred live-verification reference", () => {
    expect(node("Manual Ticket").parameters["clickupRef"]).toBe(
      "https://app.clickup.com/t/36826178/NDP-34603",
    );
  });

  test("triage has a typed four-way classification schema", () => {
    const triage = node("Triage");
    expect(triage.type).toBe(
      "@websitelabs/n8n-nodes-software-teams.softwareTeamsClaudeCode",
    );
    expect(triage.parameters["agentId"]).toBe("software-teams-support-triage");
    expect(triage.parameters["toolPolicy"]).toBe("readOnly");
    const schema = JSON.parse(String(triage.parameters["outputSchema"])) as {
      properties: { classification: { enum: string[] } };
    };
    expect(schema.properties.classification.enum).toEqual([
      "question",
      "bug",
      "change-request",
      "escalation",
    ]);
  });

  test("all unattended Claude nodes are read-only and bounded", () => {
    const claudeNodes = workflow.nodes.filter((candidate) =>
      candidate.type.endsWith(".softwareTeamsClaudeCode"),
    );
    expect(claudeNodes.length).toBeGreaterThanOrEqual(5);
    for (const claude of claudeNodes) {
      expect(claude.parameters["toolPolicy"]).toBe("readOnly");
      expect(Number(claude.parameters["maxTurns"])).toBeGreaterThan(0);
    }
  });

  test("the route switch names all four outcomes and every branch reaches HITL review", () => {
    const route = node("Route Classification");
    expect(route.type).toBe("n8n-nodes-base.switch");
    const rules = route.parameters["rules"] as {
      values: Array<{ outputKey: string }>;
    };
    expect(rules.values.map((rule) => rule.outputKey)).toEqual([
      "question",
      "bug",
      "change-request",
      "escalation",
    ]);

    const switchOutputs = workflow.connections["Route Classification"]?.main ?? [];
    expect(switchOutputs).toHaveLength(5);
    expect(switchOutputs[4]?.[0]?.node).toBe("Human Review");

    for (const branch of [
      "Draft Customer Answer",
      "Prepare Bug Handoff",
      "Prepare Change Handoff",
      "Prepare Escalation",
    ]) {
      expect(workflow.connections[branch]?.main[0]?.[0]?.node).toBe("Human Review");
    }
  });
});
