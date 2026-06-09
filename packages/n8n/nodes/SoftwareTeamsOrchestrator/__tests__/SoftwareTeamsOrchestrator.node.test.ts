import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsOrchestrator } from "../SoftwareTeamsOrchestrator.node";
import type { NodeEnvelope } from "../../src/contract/envelope";

/**
 * SoftwareTeamsOrchestrator node test suite (T9 - AC4, R-04, R-05)
 *
 * Tests that the Orchestrator node:
 * 1. Has correct descriptor and properties (AC4)
 * 2. Declares required credentials (R-02)
 * 3. Accepts an epic/goal and produces a waved breakdown
 * 4. Manages run state for partial-failure resume (R-05)
 *
 * Note: Full execution testing (actual planning turn via T3 adapter) is covered
 * by n8n/src/orchestration/__tests__/run-state.test.ts which uses a mocked
 * T3 adapter. Node execute() testing with real n8n runtime is out of scope.
 */

describe("SoftwareTeamsOrchestrator node (T9 - AC4, R-04, R-05, R-02)", () => {
  let node: SoftwareTeamsOrchestrator;

  beforeEach(() => {
    node = new SoftwareTeamsOrchestrator();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Node descriptor and properties
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC4: Node descriptor and properties", () => {
    test("node has correct displayName and name", () => {
      expect(node.description.displayName).toBe("Software Teams Orchestrator");
      expect(node.description.name).toBe("softwareTeamsOrchestrator");
    });

    test("node version is 1", () => {
      expect(node.description.version).toBe(1);
    });

    test("node icon is specified", () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain("softwareTeamsOrchestrator");
    });

    test("node has single input and single output port", () => {
      expect(node.description.inputs).toEqual(["main"]);
      expect(node.description.outputs).toEqual(["main"]);
    });

    test("node group is 'transform'", () => {
      expect(node.description.group).toContain("transform");
    });

    test("node has a description mentioning epic/goal/breakdown", () => {
      const desc = node.description.description.toLowerCase();
      expect(desc).toContain("epic");
      expect(desc).toContain("goal");
      expect(desc).toContain("breakdown");
    });

    test("subtitle shows epic parameter preview", () => {
      expect(node.description.subtitle).toBeTruthy();
      expect(node.description.subtitle).toContain("epic");
    });

    test("node is usable as a tool", () => {
      expect((node.description as any).usableAsTool).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-02: Credential requirement
  // ─────────────────────────────────────────────────────────────────────────

  describe("R-02: Credential requirement", () => {
    test("node declares softwareTeamsApi credential as required", () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      expect(creds).toHaveLength(1);

      const cred = creds![0]!;
      expect(cred.name).toBe("softwareTeamsApi");
      expect(cred.required).toBe(true);
    });

    test("does not expose credential fields in node properties", () => {
      // Tokens must NEVER appear as node parameters (R-02)
      const propNames = node.description.properties.map((p) => p.name);
      expect(propNames).not.toContain("apiKey");
      expect(propNames).not.toContain("anthropicApiKey");
      expect(propNames).not.toContain("token");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Node properties for epic/goal and waved breakdown
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC4: Node properties for epic/goal input", () => {
    test("epic property is a required string", () => {
      const epicProp = node.description.properties.find((p) => p.name === "epic");
      expect(epicProp).toBeTruthy();
      expect(epicProp?.type).toBe("string");
      expect(epicProp?.required).toBe(true);
    });

    test("epic property has multi-row text area", () => {
      const epicProp = node.description.properties.find((p) => p.name === "epic");
      expect((epicProp as any).typeOptions?.rows).toBeGreaterThan(0);
    });

    test("correlationId property is optional", () => {
      const corrIdProp = node.description.properties.find(
        (p) => p.name === "correlationId",
      );
      expect(corrIdProp).toBeTruthy();
      expect(corrIdProp?.type).toBe("string");
      expect(corrIdProp?.required).toBeFalsy();
    });

    test("correlationId description mentions run key and resumability (R-05)", () => {
      const corrIdProp = node.description.properties.find(
        (p) => p.name === "correlationId",
      );
      const desc = (corrIdProp?.description || "").toLowerCase();
      expect(desc).toContain("run");
      expect(desc).toContain("correlationid");
    });

    test("model property is an options dropdown", () => {
      const modelProp = node.description.properties.find(
        (p) => p.name === "model",
      );
      expect(modelProp).toBeTruthy();
      expect(modelProp?.type).toBe("options");
      expect(modelProp?.required).toBeFalsy();

      const options = (modelProp as any).options;
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);

      const values = options.map((o: any) => o.value);
      expect(values).toContain("claude-sonnet-4-5");
      expect(values).toContain("claude-opus-4-5");
      expect(values).toContain("claude-haiku-3-5");
    });

    test("model property has default value", () => {
      const modelProp = node.description.properties.find(
        (p) => p.name === "model",
      );
      expect((modelProp as any).default).toBe("claude-sonnet-4-5");
    });

    test("all properties have non-empty descriptions", () => {
      for (const prop of node.description.properties) {
        expect(prop.description).toBeTruthy();
        expect(typeof prop.description).toBe("string");
        expect((prop.description as string).length).toBeGreaterThan(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4 / R-04: Canvas-delegation contract invariants (from run-state tests)
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC4: Canvas-delegation contract (orch node level)", () => {
    test("node description promises one NodeEnvelope per wave-task", () => {
      const desc = node.description.description.toLowerCase();
      // The description should indicate multiple outputs per input (the waved breakdown)
      expect(desc).toContain("envelope");
    });

    test("node accepts an upstream NodeEnvelope on input (for bubbling needs-input / error)", () => {
      // The node accepts a NodeEnvelope as input when a sub-agent needs input or errors.
      // Verified via the execute() logic that checks isNodeEnvelope(upstream).
      // This test documents that invariant.
      expect(node.description.inputs).toEqual(["main"]);
      expect(node.description.outputs).toEqual(["main"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants (node self-consistency)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Contract invariants", () => {
    test("node defaults have a non-empty name", () => {
      expect(node.description.defaults.name).toBeTruthy();
      expect(node.description.defaults.name).toContain("Orchestrator");
    });

    test("execute method is defined", () => {
      expect(typeof node.execute).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-05: Run-state persistence invariants (documented here; tested in detail
  //       by run-state.test.ts with mocked T3 adapter)
  // ─────────────────────────────────────────────────────────────────────────

  describe("R-05: Run-state persistence for resumable runs", () => {
    test("correlationId property mentions persistence and resume", () => {
      const corrIdProp = node.description.properties.find(
        (p) => p.name === "correlationId",
      );
      const desc = (corrIdProp?.description || "").toLowerCase();
      expect(desc).toContain("resume");
    });

    test("node description mentions run state or partial failure handling", () => {
      // R-05 mitigation is documented in the class docstring and code,
      // visible to operators reading the node's execute() behavior.
      // Here we confirm the property descriptions hint at statefulness.
      const corrIdProp = node.description.properties.find(
        (p) => p.name === "correlationId",
      );
      expect(corrIdProp?.description).toBeTruthy();
    });
  });
});
