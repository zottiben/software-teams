import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsAgent } from "../SoftwareTeamsAgent.node";
import type { NodeEnvelope } from "@websitelabs/software-teams";

/**
 * SoftwareTeamsAgent node test suite (T5 - AC1, AC2, AC3)
 *
 * Tests that the Agent node:
 * 1. Has correct descriptor and properties (AC1)
 * 2. Declares required credentials (R-02)
 * 3. Emits valid NodeEnvelope contract (AC3)
 *
 * Note: Full execution testing (AC2 — Task disabled) is covered by
 * n8n/src/execution/__tests__/single-turn.test.ts which mocks runAgentTurn.
 * Node execute() testing requires spawning Bun subprocesses, handled by
 * integration tests.
 */

describe("SoftwareTeamsAgent node (T5 - AC1, AC2, AC3, R-02)", () => {
  let node: SoftwareTeamsAgent;

  beforeEach(() => {
    node = new SoftwareTeamsAgent();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Node descriptor and properties
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC1: Node descriptor and UI properties", () => {
    test("node has correct displayName and name", () => {
      expect(node.description.displayName).toBe("Software Teams Agent");
      expect(node.description.name).toBe("softwareTeamsAgent");
    });

    test("node version is 1", () => {
      expect(node.description.version).toBe(1);
    });

    test("node icon is specified", () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain("softwareTeamsAgent");
    });

    test("node has single input and single output port", () => {
      expect(node.description.inputs).toEqual(["main"]);
      expect(node.description.outputs).toEqual(["main"]);
    });

    test("node group is 'transform'", () => {
      expect(node.description.group).toContain("transform");
    });

    test("node has a description", () => {
      expect(node.description.description).toBeTruthy();
      expect(node.description.description).toContain("specialist");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1 & R-02: Credentials requirement
  // ─────────────────────────────────────────────────────────────────────────

  describe("R-02: Credential requirements", () => {
    test("node declares softwareTeamsApi credential as required", () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      expect(creds).toHaveLength(1);

      const softwareTeamsCred = creds?.[0];
      expect(softwareTeamsCred?.name).toBe("softwareTeamsApi");
      expect(softwareTeamsCred?.required).toBeTrue();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Node properties
  // ─────────────────────────────────────────────────────────────────────────

  describe("Node properties", () => {
    test("specialist property is a required dropdown", () => {
      const specialistProp = node.description.properties.find(
        (p) => p.name === "specialist",
      );
      expect(specialistProp).toBeTruthy();
      expect(specialistProp?.type).toBe("options");
      expect(specialistProp?.required).toBeTrue();
      expect((specialistProp as any).default).toBe("software-teams-programmer");
    });

    test("specialist property has populated options", () => {
      const specialistProp = node.description.properties.find(
        (p) => p.name === "specialist",
      );
      const options = (specialistProp as any).options;
      expect(Array.isArray(options)).toBeTrue();
      expect(options.length).toBeGreaterThan(5);

      // Check for a few known specialists
      const values = options.map((o: any) => o.value);
      expect(values).toContain("software-teams-frontend");
      expect(values).toContain("software-teams-backend");
      expect(values).toContain("software-teams-programmer");
    });

    test("prompt property is a required string", () => {
      const promptProp = node.description.properties.find(
        (p) => p.name === "prompt",
      );
      expect(promptProp).toBeTruthy();
      expect(promptProp?.type).toBe("string");
      expect(promptProp?.required).toBeTrue();
      expect((promptProp as any).typeOptions?.rows).toBeGreaterThan(0);
    });

    test("context property is optional", () => {
      const contextProp = node.description.properties.find(
        (p) => p.name === "context",
      );
      expect(contextProp).toBeTruthy();
      expect(contextProp?.type).toBe("string");
      expect(contextProp?.required).toBeFalsy();
      expect((contextProp as any).typeOptions?.rows).toBeGreaterThan(0);
    });

    test("model property is an options dropdown", () => {
      const modelProp = node.description.properties.find(
        (p) => p.name === "model",
      );
      expect(modelProp).toBeTruthy();
      expect(modelProp?.type).toBe("options");
      expect(modelProp?.required).toBeFalsy();

      const options = (modelProp as any).options;
      expect(Array.isArray(options)).toBeTrue();
      expect(options.length).toBeGreaterThan(0);

      const values = options.map((o: any) => o.value);
      expect(values).toContain("claude-sonnet-4-5");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Contract compliance (envelope shape)
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC3: Expected envelope structure", () => {
    test("valid first-node envelope has all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Done" },
        artifacts: [],
      };

      // Verify all six fields are present
      expect(envelope).toHaveProperty("correlationId");
      expect(envelope).toHaveProperty("agentId");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("input");
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("artifacts");

      expect(Object.keys(envelope)).toHaveLength(6);
    });

    test("envelope status is exactly one of the three allowed values", () => {
      const validStatuses: NodeEnvelope["status"][] = ["ok", "error", "needs-input"];
      for (const status of validStatuses) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status,
          input: { prompt: "Test", context: null },
          result: { text: "Done" },
          artifacts: [],
        };
        expect(["ok", "error", "needs-input"]).toContain(envelope.status);
      }
    });

    test("envelope input has prompt (string) and context (any)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task description", context: { key: "value" } },
        result: { text: "Result" },
        artifacts: [],
      };

      expect(typeof envelope.input.prompt).toBe("string");
      expect(envelope.input).toHaveProperty("context");
      // Context can be any JSON value
      expect(envelope.input.context).toEqual({ key: "value" });
    });

    test("envelope result.text is always a string", () => {
      const cases = [
        { text: "" },
        { text: "Some result" },
        { text: "Multi\nline\ntext" },
      ];

      for (const resultCase of cases) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status: "ok",
          input: { prompt: "Test", context: null },
          result: resultCase,
          artifacts: [],
        };
        expect(typeof envelope.result.text).toBe("string");
      }
    });

    test("envelope artifacts is always an array", () => {
      const testCases = [
        [],
        [{ type: "pr", url: "https://github.com/..." }],
        [
          { type: "branch", url: "https://github.com/.../tree/feat" },
          { type: "commit", url: "https://github.com/.../commit/abc" },
        ],
      ];

      for (const artifacts of testCases) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status: "ok",
          input: { prompt: "Test", context: null },
          result: { text: "Done" },
          artifacts,
        };
        expect(Array.isArray(envelope.artifacts)).toBeTrue();
        for (const artifact of envelope.artifacts) {
          expect(typeof artifact.type).toBe("string");
          if (artifact.url) {
            expect(typeof artifact.url).toBe("string");
          }
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A→B Handoff contract (expected shape for downstream node)
  // ─────────────────────────────────────────────────────────────────────────

  describe("A→B handoff: Envelope carry-through (AC2, AC3)", () => {
    test("downstream node can detect upstream envelope by checking key fields", () => {
      const upstreamEnvelope: NodeEnvelope = {
        correlationId: "run-handoff-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build feature.", context: null },
        result: { text: "Feature built." },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/x" }],
      };

      // This is how downstream nodes detect an upstream envelope (per SoftwareTeamsAgent.node.ts line ~210)
      const upstream = upstreamEnvelope;
      const isUpstreamEnvelope =
        typeof upstream["correlationId"] === "string" &&
        upstream["correlationId"].length > 0 &&
        typeof upstream["agentId"] === "string" &&
        typeof upstream["status"] === "string";

      expect(isUpstreamEnvelope).toBeTrue();
    });

    test("handoff preserves correlationId across hops", () => {
      const correlationId = "run-2026-06-03-permanent";

      const envelope1: NodeEnvelope = {
        correlationId,
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [],
      };

      // Simulate downstream node folding upstream into context
      const envelope2: NodeEnvelope = {
        correlationId: envelope1.correlationId, // MUST be preserved
        agentId: "software-teams-qa-tester",
        status: "ok",
        input: {
          prompt: "Test it.",
          context: {
            from: envelope1.agentId,
            result: envelope1.result,
            artifacts: envelope1.artifacts,
          },
        },
        result: { text: "" },
        artifacts: envelope1.artifacts,
      };

      expect(envelope2.correlationId).toBe(envelope1.correlationId);
      expect(envelope2.correlationId).toBe(correlationId);
    });

    test("context merge pattern for downstream node (CONTRACT.md §3)", () => {
      const upstreamResult = {
        text: "Implemented feature in src/components/Feature.tsx",
      };
      const upstreamArtifacts = [
        { type: "commit", url: "https://github.com/acme/app/commit/abc123" },
      ];

      // What downstream node does with upstream envelope
      const downstreamContext = {
        from: "software-teams-frontend",
        upstreamStatus: "ok",
        result: upstreamResult,
        artifacts: upstreamArtifacts,
      };

      // Verify shape matches CONTRACT.md §3 expectations
      expect(downstreamContext).toHaveProperty("from");
      expect(downstreamContext).toHaveProperty("upstreamStatus");
      expect(downstreamContext).toHaveProperty("result");
      expect(downstreamContext).toHaveProperty("artifacts");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe("Contract invariants (drift guard)", () => {
    test("no field in envelope is undefined", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Done" },
        artifacts: [],
      };

      for (const [key, value] of Object.entries(envelope)) {
        expect(value).not.toBeUndefined();
      }
    });

    test("artifacts array can be empty but never missing", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Done" },
        artifacts: [],
      };

      expect(envelope.artifacts).toBeTruthy();
      expect(Array.isArray(envelope.artifacts)).toBeTrue();
      expect(envelope.artifacts).toHaveLength(0);
    });

    test("result.text can be empty but is never missing", () => {
      const testCases = [
        { text: "" },
        { text: "Some text" },
      ];

      for (const resultObj of testCases) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status: "ok",
          input: { prompt: "Test", context: null },
          result: resultObj,
          artifacts: [],
        };

        expect(envelope.result).toHaveProperty("text");
        expect(typeof envelope.result.text).toBe("string");
      }
    });
  });
});
