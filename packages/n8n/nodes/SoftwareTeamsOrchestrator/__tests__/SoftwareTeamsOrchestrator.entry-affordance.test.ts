import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SoftwareTeamsOrchestrator } from "../SoftwareTeamsOrchestrator.node";

const EXAMPLE_PATH = join(import.meta.dir, "../../../examples/repo-pr.workflow.json");

interface ExampleNode {
  readonly name: string;
  readonly type: string;
  readonly parameters?: Record<string, unknown>;
}

interface ExampleConnection {
  readonly node: string;
}

interface ExampleWorkflow {
  readonly nodes: ExampleNode[];
  readonly connections: Record<string, { main: ExampleConnection[][] }>;
}

function loadExample(): ExampleWorkflow {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")) as ExampleWorkflow;
}

describe("entry-affordance back-compat — existing Orchestrator entry unchanged (AC11)", () => {
  test("the Orchestrator still accepts an `epic` field (the existing prompt entry)", () => {
    const node = new SoftwareTeamsOrchestrator();
    const epic = node.description.properties.find((p) => p.name === "epic");
    expect(epic).toBeDefined();
    expect(epic?.type).toBe("string");
    expect(epic?.required).toBeTrue();
  });

  test("plan is still the default operation — the existing fan-out entry behaves as today", () => {
    const node = new SoftwareTeamsOrchestrator();
    const op = node.description.properties.find((p) => p.name === "operation");
    expect((op as { default: string }).default).toBe("plan");
  });

  test("the Orchestrator input/output ports are unchanged (single main in/out)", () => {
    const node = new SoftwareTeamsOrchestrator();
    expect(node.description.inputs).toEqual(["main"]);
    expect(node.description.outputs).toEqual(["main"]);
  });
});

describe("the sole-owned example reflects the entry affordance + forward-only topology (AC11/AC5)", () => {
  test("a Form Trigger entry affordance supplies repo + prompt without replacing the manual entry", () => {
    const wf = loadExample();
    const formTrigger = wf.nodes.find((n) => n.type === "n8n-nodes-base.formTrigger");
    expect(formTrigger).toBeDefined();
    const fields = JSON.stringify(formTrigger?.parameters ?? {});
    expect(fields).toContain("Target Repository");
    expect(fields).toContain("Prompt / Epic");
  });

  test("the manual entry (Workspace → Orchestrator) is preserved alongside the affordance", () => {
    const wf = loadExample();
    const workspace = wf.nodes.find((n) => n.type.endsWith("softwareTeamsWorkspace"));
    const orchestrator = wf.nodes.find((n) => n.type.endsWith("softwareTeamsOrchestrator") && n.parameters?.["operation"] === "plan");
    expect(workspace).toBeDefined();
    expect(orchestrator).toBeDefined();
    const fromWorkspace = wf.connections[workspace!.name]?.main[0]?.map((c) => c.node) ?? [];
    expect(fromWorkspace).toContain(orchestrator!.name);
  });

  test("forward-only DAG: no Agent → Orchestrator return edge (ADR-002 Decision F, AC5)", () => {
    const wf = loadExample();
    const planOrchestrator = wf.nodes.find((n) => n.type.endsWith("softwareTeamsOrchestrator") && n.parameters?.["operation"] === "plan");
    const agentNodes = wf.nodes.filter((n) => n.type.endsWith("softwareTeamsAgent")).map((n) => n.name);
    for (const agent of agentNodes) {
      const targets = wf.connections[agent]?.main[0]?.map((c) => c.node) ?? [];
      expect(targets).not.toContain(planOrchestrator!.name);
    }
  });

  test("the example topology keeps Workspace → Orchestrator(plan) → Agents → summary → Finaliser → Output (AC5)", () => {
    const wf = loadExample();
    const names = wf.nodes.map((n) => n.type);
    expect(names.some((t) => t.endsWith("softwareTeamsWorkspace"))).toBeTrue();
    expect(names.filter((t) => t.endsWith("softwareTeamsOrchestrator")).length).toBe(2);
    expect(names.filter((t) => t.endsWith("softwareTeamsAgent")).length).toBeGreaterThanOrEqual(1);
    expect(names.some((t) => t.endsWith("softwareTeamsFinaliser"))).toBeTrue();
    expect(names.some((t) => t.endsWith("softwareTeamsOutput"))).toBeTrue();

    const finaliser = wf.nodes.find((n) => n.type.endsWith("softwareTeamsFinaliser"))!;
    const output = wf.nodes.find((n) => n.type.endsWith("softwareTeamsOutput"))!;
    const fromFinaliser = wf.connections[finaliser.name]?.main[0]?.map((c) => c.node) ?? [];
    expect(fromFinaliser).toContain(output.name);
  });

  test("the summary Orchestrator is wired forward into the Finaliser (no return edge introduced)", () => {
    const wf = loadExample();
    const summary = wf.nodes.find((n) => n.type.endsWith("softwareTeamsOrchestrator") && n.parameters?.["operation"] === "summary")!;
    const finaliser = wf.nodes.find((n) => n.type.endsWith("softwareTeamsFinaliser"))!;
    const fromSummary = wf.connections[summary.name]?.main[0]?.map((c) => c.node) ?? [];
    expect(fromSummary).toContain(finaliser.name);
  });
});
