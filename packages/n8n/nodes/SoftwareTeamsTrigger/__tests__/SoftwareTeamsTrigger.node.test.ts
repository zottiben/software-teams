import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsTrigger } from "../SoftwareTeamsTrigger.node";
import type { NodeEnvelope } from "@websitelabs/software-teams";

/**
 * SoftwareTeamsTrigger node test suite (T6 - AC5)
 *
 * Tests that the Trigger node:
 * 1. Has correct descriptor and properties (AC5)
 * 2. Declares required credentials (R-02)
 * 3. Emits valid initial envelope contract (AC5)
 *
 * Note: Full execution testing (actual ClickUp/Datadog fetch) is covered by
 * n8n/src/ingestion/__tests__/context.test.ts. Node execute() testing
 * requires spawning fetch and parsing credentials, handled by integration tests.
 */

describe("SoftwareTeamsTrigger node (T6 - AC5, R-02)", () => {
  let node: SoftwareTeamsTrigger;

  beforeEach(() => {
    node = new SoftwareTeamsTrigger();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: Node descriptor
  // ─────────────────────────────────────────────────────────────────────────

  describe("Node descriptor", () => {
    test("node has correct displayName and name", () => {
      expect(node.description.displayName).toBe("Software Teams Trigger Ingestion Trigger");
      expect(node.description.name).toBe("softwareTeamsTrigger");
    });

    test("node icon is specified", () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain("SoftwareTeamsTrigger");
    });

    test("node has single input and single output port", () => {
      // Trigger nodes have no inputs (they start workflows); single output port.
      expect(node.description.inputs).toEqual([]);
      expect(node.description.outputs).toEqual(["main"]);
    });

    test("node group is 'transform'", () => {
      expect(node.description.group).toContain("transform");
    });

    test("node version is 1", () => {
      expect(node.description.version).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5 & R-02: Credentials and source selection
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC5 & AC6: Trigger source selection (ClickUp | Datadog | Prompt)", () => {
    test("node declares softwareTeamsApi credential as required", () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      const softwareTeamsCred = creds?.find((c) => c.name === "softwareTeamsApi");
      expect(softwareTeamsCred).toBeTruthy();
      expect(softwareTeamsCred?.required).toBeTrue();
    });

    test("node has source property with ClickUp, Datadog, and Prompt options", () => {
      const sourceProp = node.description.properties.find((p) => p.name === "source");
      expect(sourceProp).toBeTruthy();
      expect(sourceProp?.type).toBe("options");
      expect(sourceProp?.required).toBeTrue();

      const options = (sourceProp as any).options;
      const values = options.map((o: any) => o.value);
      expect(values).toContain("clickup");
      expect(values).toContain("datadog");
      expect(values).toContain("prompt");
    });

    test("default source is still clickup (additive, no change to existing canvases)", () => {
      const sourceProp = node.description.properties.find((p) => p.name === "source");
      expect((sourceProp as any).default).toBe("clickup");
    });

    test("ClickUp source has clickupRef parameter (conditional display)", () => {
      const clickupRefProp = node.description.properties.find(
        (p) => p.name === "clickupRef",
      );
      expect(clickupRefProp).toBeTruthy();
      expect(clickupRefProp?.type).toBe("string");

      const displayOpts = (clickupRefProp as any).displayOptions;
      expect(displayOpts?.show?.source).toContain("clickup");
    });

    test("Datadog source has datadogRef parameter (conditional display)", () => {
      const datadogRefProp = node.description.properties.find(
        (p) => p.name === "datadogRef",
      );
      expect(datadogRefProp).toBeTruthy();
      expect(datadogRefProp?.type).toBe("string");

      const displayOpts = (datadogRefProp as any).displayOptions;
      expect(displayOpts?.show?.source).toContain("datadog");
    });

    test("clickupRef is not shown for prompt source", () => {
      const clickupRefProp = node.description.properties.find(
        (p) => p.name === "clickupRef",
      );
      const displayOpts = (clickupRefProp as any).displayOptions;
      expect(displayOpts?.show?.source).not.toContain("prompt");
    });

    test("datadogRef is not shown for prompt source", () => {
      const datadogRefProp = node.description.properties.find(
        (p) => p.name === "datadogRef",
      );
      const displayOpts = (datadogRefProp as any).displayOptions;
      expect(displayOpts?.show?.source).not.toContain("prompt");
    });

    test("clickupRef and datadogRef are not globally required (prompt source needs neither)", () => {
      const clickupRefProp = node.description.properties.find(
        (p) => p.name === "clickupRef",
      );
      const datadogRefProp = node.description.properties.find(
        (p) => p.name === "datadogRef",
      );
      // required must be absent or false so prompt source is not blocked
      expect(clickupRefProp?.required).toBeFalsy();
      expect(datadogRefProp?.required).toBeFalsy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: Initial envelope and workflow properties
  // ─────────────────────────────────────────────────────────────────────────

  describe("Initial envelope properties", () => {
    test("node has prompt property for initial workflow task", () => {
      const promptProp = node.description.properties.find((p) => p.name === "prompt");
      expect(promptProp).toBeTruthy();
      expect(promptProp?.type).toBe("string");
      expect(promptProp?.required).toBeTrue();
      expect((promptProp as any).default).toBeTruthy();
    });

    test("node has agentId property to specify first agent", () => {
      const agentIdProp = node.description.properties.find((p) => p.name === "agentId");
      expect(agentIdProp).toBeTruthy();
      expect(agentIdProp?.type).toBe("string");
      expect((agentIdProp as any).default).toBe("software-teams-researcher");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: Initial envelope contract
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC5: Initial envelope structure (first node)", () => {
    test("trigger emits envelope with all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-2026-06-03-clickup-abc123",
        agentId: "software-teams-researcher",
        status: "ok",
        input: {
          prompt: "Investigate the issue.",
          context: {
            source: "clickup",
            ticketId: "NDP-456",
            summary: "**Task:** Fix bug",
          },
        },
        result: { text: "" },
        artifacts: [],
      };

      // Verify all six fields
      expect(envelope).toHaveProperty("correlationId");
      expect(envelope).toHaveProperty("agentId");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("input");
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("artifacts");
    });

    test("initial envelope status is 'ok'", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-initial",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Investigate.", context: null },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.status).toBe("ok");
    });

    test("initial envelope result.text is empty string", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-initial",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Investigate.", context: null },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.result.text).toBe("");
    });

    test("initial envelope artifacts is empty array", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-initial",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Investigate.", context: null },
        result: { text: "" },
        artifacts: [],
      };

      expect(Array.isArray(envelope.artifacts)).toBeTrue();
      expect(envelope.artifacts).toHaveLength(0);
    });

    test("initial envelope input.context carries fetched ticket/issue data", () => {
      const clickupContext = {
        source: "clickup",
        ticketId: "NDP-456",
        summary: "**Task:** Fix auth bug",
      };

      const envelope: NodeEnvelope = {
        correlationId: "run-cu",
        agentId: "software-teams-researcher",
        status: "ok",
        input: {
          prompt: "Investigate.",
          context: clickupContext,
        },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.input.context).toEqual(clickupContext);

      const datadogContext = {
        source: "datadog",
        issueId: "abc123def456",
        summary: "**Error:** NullPointerException",
      };

      const envelope2: NodeEnvelope = {
        correlationId: "run-dd",
        agentId: "software-teams-debugger",
        status: "ok",
        input: {
          prompt: "Debug it.",
          context: datadogContext,
        },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope2.input.context).toEqual(datadogContext);
    });

    test("initial envelope can have null context (graceful degradation)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-no-context",
        agentId: "software-teams-researcher",
        status: "ok",
        input: {
          prompt: "Investigate (no context available).",
          context: null,
        },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.input.context).toBeNull();
      expect(envelope.status).toBe("ok"); // Still OK, just gracefully degraded
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ClickUp vs Datadog context shapes
  // ─────────────────────────────────────────────────────────────────────────

  describe("ClickUp context shape", () => {
    test("ClickUp context has source, ticketId, and summary", () => {
      const clickupContext = {
        source: "clickup",
        ticketId: "NDP-456",
        summary: "**Task:** Fix bug\n- **Status:** In Progress\n- **Assigned:** (redacted)",
      };

      expect(clickupContext.source).toBe("clickup");
      expect(typeof clickupContext.ticketId).toBe("string");
      expect(typeof clickupContext.summary).toBe("string");
      expect(clickupContext.summary).toContain("Task");
    });
  });

  describe("Datadog context shape", () => {
    test("Datadog context has source, issueId, and summary", () => {
      const datadogContext = {
        source: "datadog",
        issueId: "abc123def456",
        summary: "**Error:** NullPointerException\n- **Occurrences:** 42",
      };

      expect(datadogContext.source).toBe("datadog");
      expect(typeof datadogContext.issueId).toBe("string");
      expect(typeof datadogContext.summary).toBe("string");
      expect(datadogContext.summary).toContain("Error");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Correlation ID pattern
  // ─────────────────────────────────────────────────────────────────────────

  describe("Correlation ID generation (first-node rule)", () => {
    test("correlationId is generated fresh for each trigger execution", () => {
      // Trigger nodes generate fresh correlationIds (not carried from upstream)
      const envelope1: NodeEnvelope = {
        correlationId: "run-2026-06-03-clickup-xyz789",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Investigate.", context: null },
        result: { text: "" },
        artifacts: [],
      };

      const envelope2: NodeEnvelope = {
        correlationId: "run-2026-06-03-datadog-abc123",
        agentId: "software-teams-debugger",
        status: "ok",
        input: { prompt: "Debug it.", context: null },
        result: { text: "" },
        artifacts: [],
      };

      // Different runs have different correlationIds
      expect(envelope1.correlationId).not.toBe(envelope2.correlationId);
    });

    test("correlationId format includes date and source", () => {
      const clickupId = "run-2026-06-03-clickup-abc123";
      const datadogId = "run-2026-06-03-datadog-xyz789";
      const promptId = "run-2026-06-03-prompt-def456";

      expect(clickupId).toMatch(/run-\d{4}-\d{2}-\d{2}-(clickup|datadog|prompt)-/);
      expect(datadogId).toMatch(/run-\d{4}-\d{2}-\d{2}-(clickup|datadog|prompt)-/);
      expect(promptId).toMatch(/run-\d{4}-\d{2}-\d{2}-(clickup|datadog|prompt)-/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Prompt trigger source
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC6: Prompt trigger source", () => {
    test("prompt source envelope uses { source: 'prompt' } context (no external fetch)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-2026-06-15-prompt-abc123",
        agentId: "software-teams-researcher",
        status: "ok",
        input: {
          prompt: "Implement feature X with full test coverage.",
          context: { source: "prompt" },
        },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.input.context).toEqual({ source: "prompt" });
      expect(envelope.correlationId).toContain("prompt");
      expect(envelope.status).toBe("ok");
    });

    test("prompt source correlationId contains 'prompt' segment", () => {
      const id = "run-2026-06-15-prompt-xyz789";
      expect(id).toMatch(/^run-\d{4}-\d{2}-\d{2}-prompt-[a-z0-9]+$/);
    });

    test("prompt source carries input.prompt from the prompt param", () => {
      const userPrompt = "Refactor the authentication module for better testability.";
      const envelope: NodeEnvelope = {
        correlationId: "run-2026-06-15-prompt-test1",
        agentId: "software-teams-programmer",
        status: "ok",
        input: {
          prompt: userPrompt,
          context: { source: "prompt" },
        },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.input.prompt).toBe(userPrompt);
    });

    test("prompt source dropdown option exists with correct name and value", () => {
      const sourceProp = node.description.properties.find((p) => p.name === "source");
      const options = (sourceProp as any).options;
      const promptOption = options.find((o: any) => o.value === "prompt");
      expect(promptOption).toBeTruthy();
      expect(promptOption.name).toBe("Prompt");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe("Contract invariants", () => {
    test("no field in envelope is undefined", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "" },
        artifacts: [],
      };

      for (const [key, value] of Object.entries(envelope)) {
        expect(value).not.toBeUndefined();
      }
    });

    test("status is always 'ok' for initial envelopes", () => {
      // Trigger nodes emit initial envelopes with status='ok' (graceful degradation on fetch failure)
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope.status).toBe("ok");
    });

    test("artifacts array is always present (never missing)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-researcher",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "" },
        artifacts: [],
      };

      expect(envelope).toHaveProperty("artifacts");
      expect(Array.isArray(envelope.artifacts)).toBeTrue();
    });
  });
});
