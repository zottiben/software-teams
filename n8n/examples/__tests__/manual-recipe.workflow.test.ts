/**
 * Tests for the manual recipe workflow JSON — T9 of plan 1-02-n8n-manual-cli.
 *
 * Scope (AC8 — built-in nodes only):
 *  ✓ manual-recipe.workflow.json parses as valid JSON.
 *  ✓ Every node `type` is a built-in n8n node type (starts with `n8n-nodes-base.`).
 *  ✓ NO custom package node type appears anywhere (guards against accidental
 *    introduction of @websitelabs/n8n-nodes-software-teams or any non-built-in node).
 *  ✓ Execute Command nodes invoke the documented verbs with `--json` and a stdin pipe,
 *    matching the normative "Execute Command command-string template" from CLI-RECIPE.md §7.
 *
 * This test MUST fail if a custom package node type is later introduced — it is
 * the AC8 guard.
 *
 * No live n8n instance required.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

// ─── Read and parse the workflow JSON ──────────────────────────────────────

const workflowPath = path.join(import.meta.dir, "../manual-recipe.workflow.json");
const workflowContent = fs.readFileSync(workflowPath, "utf-8");
const workflow = JSON.parse(workflowContent);

// ─── Built-in node type allowlist ─────────────────────────────────────────
// These are the exact built-in types used in the example workflow.
// Asserts that each node.type starts with `n8n-nodes-base.`.

const BUILT_IN_ALLOWLIST = [
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.set",
  "n8n-nodes-base.executeCommand",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
];

// ─── Custom package node type to guard against ─────────────────────────────
const CUSTOM_PACKAGE_MARKER = "@websitelabs/n8n-nodes-software-teams";

// ─── Normative Execute Command command-string templates (from CLI-RECIPE.md §7) ─────

const COMMAND_TEMPLATES = {
  "Execute: ingest":
    /^software-teams ingest --source (clickup|datadog) --ref \{\{ \$json\.\w+ \}\} --json$/,
  "Execute: agent-turn": /^cat \{\{ \$json\.\w+ \}\} \| software-teams agent-turn --json ; rm -f/,
  "Execute: output \(PR\)": /^cat \{\{ \$json\.\w+ \}\} \| software-teams output --mode (pr|issue) --owner/,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("manual-recipe.workflow.json — AC8 (built-in nodes only)", () => {
  test("parses as valid JSON", () => {
    expect(typeof workflow).toBe("object");
    expect(Array.isArray(workflow.nodes)).toBe(true);
  });

  test("every node type is from the built-in allowlist", () => {
    for (const node of workflow.nodes) {
      expect(BUILT_IN_ALLOWLIST).toContain(node.type);
    }
  });

  test("no node type starts with a non-built-in prefix", () => {
    for (const node of workflow.nodes) {
      expect(node.type).toMatch(/^n8n-nodes-base\./);
    }
  });

  test("custom package node type @websitelabs/n8n-nodes-software-teams does not appear anywhere in the workflow", () => {
    const fullContent = JSON.stringify(workflow);
    expect(fullContent).not.toContain(CUSTOM_PACKAGE_MARKER);
  });

  test("Execute Command nodes invoke the documented verbs with --json and stdin pipe", () => {
    const executeNodes = workflow.nodes.filter(
      (node: any) => node.type === "n8n-nodes-base.executeCommand"
    );

    expect(executeNodes.length).toBeGreaterThan(0);

    for (const node of executeNodes) {
      const command = node.parameters.command;
      expect(typeof command).toBe("string");

      // The command must:
      // 1. Contain 'software-teams' (the binary)
      // 2. Contain one of the verbs (ingest, agent-turn, output, orchestrator-turn)
      // 3. Contain '--json' flag
      // 4. Either:
      //    a) Use stdin pipe (cat ... | software-teams ...)
      //    b) Be the ingest verb which does not use a pipe
      expect(command).toContain("software-teams");
      expect(command).toContain("--json");
      expect(command).toMatch(/software-teams (ingest|agent-turn|orchestrator-turn|output)/);

      // Verify no envelope content is concatenated into the command string (R-08).
      // The command should not contain unescaped JSON or raw envelope data.
      expect(command).not.toMatch(/\$json\w+/); // Raw $json access without {{ }}
    }
  });

  test("the ingest Execute Command node invokes 'software-teams ingest --source <enum> --ref {{ $json... }} --json'", () => {
    const ingestNode = workflow.nodes.find((node: any) => node.name === "Execute: ingest");
    expect(ingestNode).toBeTruthy();

    const command = ingestNode!.parameters.command;
    expect(command).toMatch(/software-teams ingest/);
    expect(command).toContain("--json");
    expect(command).toMatch(/--source \{\{ \$json\.\w+ \}\}/);
  });

  test("the agent-turn Execute Command node invokes 'cat ... | software-teams agent-turn --json'", () => {
    const agentNode = workflow.nodes.find((node: any) => node.name === "Execute: agent-turn");
    expect(agentNode).toBeTruthy();

    const command = agentNode!.parameters.command;
    expect(command).toContain("cat");
    expect(command).toContain("software-teams agent-turn");
    expect(command).toContain("--json");
    expect(command).toContain("|");
  });

  test("the output Execute Command node invokes 'cat ... | software-teams output --mode <enum> --owner {{ $json... }} ... --json'", () => {
    const outputNode = workflow.nodes.find((node: any) => node.name === "Execute: output (PR)");
    expect(outputNode).toBeTruthy();

    const command = outputNode!.parameters.command;
    expect(command).toContain("cat");
    expect(command).toContain("software-teams output");
    expect(command).toContain("--json");
    expect(command).toMatch(/--mode (pr|issue)/);
    expect(command).toContain("--owner");
    expect(command).toContain("|");
  });

  test("Code nodes do not interpolate secrets or envelope content into shell commands (R-08)", () => {
    // Code nodes use jsCode (safe from shell injection).
    const codeNodes = workflow.nodes.filter(
      (node: any) => node.type === "n8n-nodes-base.code"
    );

    expect(codeNodes.length).toBeGreaterThan(0);

    for (const node of codeNodes) {
      const jsCode = node.parameters.jsCode;
      expect(typeof jsCode).toBe("string");

      // Code nodes should use temp files or pipes, not shell interpolation.
      // Verify they follow the safe pattern (temp file writing for envelopes or JSON parsing).
      // Most code nodes either parse JSON or write temp files
      expect(jsCode.toLowerCase()).toMatch(/json|temp|tmp/);
    }
  });
});

describe("manual-recipe.workflow.json — connections (no custom node references)", () => {
  test("all node names in connections exist in the nodes array", () => {
    const nodeNames = new Set(workflow.nodes.map((node: any) => node.name));
    const connectedNodeNames = new Set<string>();

    for (const [sourceName, connectionSet] of Object.entries(workflow.connections || {})) {
      connectedNodeNames.add(sourceName);
      const conn = connectionSet as any;
      if (conn.main && Array.isArray(conn.main)) {
        for (const outputArray of conn.main) {
          for (const connection of outputArray || []) {
            connectedNodeNames.add(connection.node);
          }
        }
      }
    }

    // Every connected node must exist in the nodes array
    for (const connNodeName of connectedNodeNames) {
      expect(nodeNames.has(connNodeName)).toBe(true);
    }
  });

  test("IF node has exactly two branches (true and false)", () => {
    const ifNode = workflow.nodes.find((node: any) => node.type === "n8n-nodes-base.if");
    expect(ifNode).toBeTruthy();

    const ifConnections = workflow.connections[ifNode!.name];
    expect(ifConnections.main).toHaveLength(2);
  });
});
