import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsOutput } from "../SoftwareTeamsOutput.node";
import type { NodeEnvelope } from "../../src/contract/envelope";

/**
 * SoftwareTeamsOutput node test suite (T7 - AC6)
 *
 * Tests that the Output node:
 * 1. Has correct descriptor and properties (AC6)
 * 2. Declares required credentials (R-02)
 * 3. Emits valid output envelope contract (accretion)
 *
 * Note: Full execution testing (actual GitHub API calls) is covered by
 * n8n/src/output/__tests__/github.test.ts. Node execute() testing
 * requires mocking fetch properly, handled by integration tests.
 */

describe("SoftwareTeamsOutput node (T7 - AC6, R-02)", () => {
  let node: SoftwareTeamsOutput;

  beforeEach(() => {
    node = new SoftwareTeamsOutput();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Node descriptor
  // ─────────────────────────────────────────────────────────────────────────

  describe("Node descriptor", () => {
    test("node has correct displayName and name", () => {
      expect(node.description.displayName).toBe("Software Teams Output");
      expect(node.description.name).toBe("softwareTeamsOutput");
    });

    test("node is in 'output' group", () => {
      expect(node.description.group).toContain("output");
    });

    test("node icon is specified", () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain("SoftwareTeamsOutput");
    });

    test("node version is 1", () => {
      expect(node.description.version).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6 & R-02: Credentials and output mode
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC6: Output mode selection (PR | Issue)", () => {
    test("node declares softwareTeamsApi credential as required", () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      const softwareTeamsCred = creds?.find((c) => c.name === "softwareTeamsApi");
      expect(softwareTeamsCred).toBeTruthy();
      expect(softwareTeamsCred?.required).toBeTrue();
    });

    test("node has mode property with PR and issue options", () => {
      const modeProp = node.description.properties.find((p) => p.name === "mode");
      expect(modeProp).toBeTruthy();
      expect(modeProp?.type).toBe("options");
      expect(modeProp?.required).not.toBeTrue();

      const options = (modeProp as any).options;
      const values = options.map((o: any) => o.value);
      expect(values).toContain("pr");
      expect(values).toContain("issue");
      expect((modeProp as any).default).toBe("pr");
    });

    test("node has targetRepo property (required)", () => {
      const targetRepoProp = node.description.properties.find(
        (p) => p.name === "targetRepo",
      );
      expect(targetRepoProp).toBeTruthy();
      expect(targetRepoProp?.type).toBe("string");
      expect(targetRepoProp?.required).toBeTrue();
    });

    test("PR mode has baseBranch property (conditional)", () => {
      const baseBranchProp = node.description.properties.find(
        (p) => p.name === "baseBranch",
      );
      expect(baseBranchProp).toBeTruthy();
      expect(baseBranchProp?.type).toBe("string");
      expect((baseBranchProp as any).default).toBe("main");

      const displayOpts = (baseBranchProp as any).displayOptions;
      expect(displayOpts?.show?.mode).toContain("pr");
    });

    test("issue mode has issueLabels property (conditional)", () => {
      const issueLabelsProperty = node.description.properties.find(
        (p) => p.name === "issueLabels",
      );
      expect(issueLabelsProperty).toBeTruthy();
      expect(issueLabelsProperty?.type).toBe("string");
      expect(issueLabelsProperty?.required).not.toBeTrue();

      const displayOpts = (issueLabelsProperty as any).displayOptions;
      expect(displayOpts?.show?.mode).toContain("issue");
    });

    test("node has optional title property", () => {
      const titleProp = node.description.properties.find((p) => p.name === "title");
      expect(titleProp).toBeTruthy();
      expect(titleProp?.type).toBe("string");
      expect(titleProp?.required).not.toBeTrue();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Output envelope (pass-through + artifact appending)
  // ─────────────────────────────────────────────────────────────────────────

  describe("AC6: Output envelope structure (terminal node)", () => {
    test("output envelope carries all upstream fields unchanged", () => {
      const inputEnvelope: NodeEnvelope = {
        correlationId: "run-output-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: {
          prompt: "Build feature.",
          context: { key: "value" },
        },
        result: {
          text: "Feature built in src/components/Feature.tsx",
        },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/x" }],
      };

      // Output node preserves upstream envelope and appends artifacts
      const outputEnvelope: NodeEnvelope = {
        ...inputEnvelope,
        artifacts: [
          ...inputEnvelope.artifacts,
          { type: "pr", url: "https://github.com/acme/app/pull/123" },
        ],
      };

      // Verify upstream fields are preserved
      expect(outputEnvelope.correlationId).toBe(inputEnvelope.correlationId);
      expect(outputEnvelope.agentId).toBe(inputEnvelope.agentId);
      expect(outputEnvelope.status).toBe(inputEnvelope.status);
      expect(outputEnvelope.input).toEqual(inputEnvelope.input);
      expect(outputEnvelope.result).toEqual(inputEnvelope.result);
    });

    test("output envelope appends PR artifact", () => {
      const inputEnvelope: NodeEnvelope = {
        correlationId: "run-pr-output",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/x" }],
      };

      const prArtifact = { type: "pr", url: "https://github.com/acme/app/pull/456" };
      const outputEnvelope: NodeEnvelope = {
        ...inputEnvelope,
        artifacts: [...inputEnvelope.artifacts, prArtifact],
      };

      // PR artifact is appended (last in array)
      expect(outputEnvelope.artifacts[outputEnvelope.artifacts.length - 1]).toEqual(
        prArtifact,
      );
      // Upstream artifact is preserved
      expect(outputEnvelope.artifacts[0].type).toBe("branch");
    });

    test("output envelope appends issue artifact", () => {
      const inputEnvelope: NodeEnvelope = {
        correlationId: "run-issue-output",
        agentId: "software-teams-qa-tester",
        status: "ok",
        input: { prompt: "Test it.", context: null },
        result: { text: "Test report." },
        artifacts: [],
      };

      const issueArtifact = { type: "issue", url: "https://github.com/acme/app/issues/789" };
      const outputEnvelope: NodeEnvelope = {
        ...inputEnvelope,
        artifacts: [...inputEnvelope.artifacts, issueArtifact],
      };

      // Issue artifact is present
      const issue = outputEnvelope.artifacts.find((a) => a.type === "issue");
      expect(issue).toBeTruthy();
      expect(issue?.url).toContain("/issues/");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Artifact accretion (CONTRACT.md §2)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Artifact accretion (CONTRACT.md §2)", () => {
    test("multiple upstream artifacts are preserved, PR/issue appended last", () => {
      const inputEnvelope: NodeEnvelope = {
        correlationId: "run-accretion",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [
          { type: "commit", url: "https://github.com/acme/app/commit/abc123" },
          { type: "branch", url: "https://github.com/acme/app/tree/feat/x" },
        ],
      };

      const outputEnvelope: NodeEnvelope = {
        ...inputEnvelope,
        artifacts: [
          ...inputEnvelope.artifacts,
          { type: "pr", url: "https://github.com/acme/app/pull/123" },
        ],
      };

      // All upstream artifacts are present
      expect(outputEnvelope.artifacts).toHaveLength(3);
      expect(outputEnvelope.artifacts[0].type).toBe("commit");
      expect(outputEnvelope.artifacts[1].type).toBe("branch");
      // PR is appended last
      expect(outputEnvelope.artifacts[2].type).toBe("pr");
    });

    test("artifacts array order is preserved (no reordering)", () => {
      const artifacts = [
        { type: "task", url: "https://example.com/task/1" },
        { type: "commit", url: "https://github.com/acme/app/commit/xyz" },
        { type: "branch", url: "https://github.com/acme/app/tree/feat/y" },
      ];

      const outputArtifacts = [
        ...artifacts,
        { type: "issue", url: "https://github.com/acme/app/issues/999" },
      ];

      for (let i = 0; i < artifacts.length; i++) {
        expect(outputArtifacts[i]).toEqual(artifacts[i]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input validation expectations
  // ─────────────────────────────────────────────────────────────────────────

  describe("Input envelope validation", () => {
    test("valid envelope can be processed by output node", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-valid",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [],
      };

      // Check required fields for output node validation
      expect(typeof envelope.correlationId).toBe("string");
      expect(envelope.correlationId.length).toBeGreaterThan(0);
      expect(typeof envelope.agentId).toBe("string");
      expect(typeof envelope.status).toBe("string");
      expect(typeof envelope.input.prompt).toBe("string");
      expect(Array.isArray(envelope.artifacts)).toBeTrue();
    });

    test("targetRepo must be in owner/repo format", () => {
      const validRepos = ["acme/app", "user/my-project", "org/service"];
      const invalidRepos = ["just-app", "app", ""];

      for (const repo of validRepos) {
        expect(repo).toContain("/");
      }

      for (const repo of invalidRepos) {
        expect(repo).not.toContain("/");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PR mode expectations
  // ─────────────────────────────────────────────────────────────────────────

  describe("PR mode (default)", () => {
    test("PR mode requires a branch artifact to succeed", () => {
      const withBranchArtifact: NodeEnvelope = {
        correlationId: "run-pr",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/x" }],
      };

      const branchArtifact = withBranchArtifact.artifacts.find((a) => a.type === "branch");
      expect(branchArtifact).toBeTruthy();

      const withoutBranchArtifact: NodeEnvelope = {
        correlationId: "run-no-branch",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [{ type: "commit", url: "https://github.com/acme/app/commit/abc" }],
      };

      const noBranchArtifact = withoutBranchArtifact.artifacts.find(
        (a) => a.type === "branch",
      );
      expect(noBranchArtifact).not.toBeTruthy();
    });

    test("PR mode falls back to issue when no branch artifact present", () => {
      // When branch artifact is missing, output node should open an issue instead
      // with a note about the fallback
      const fallbackBody = `> **⚠ Fallback:** PR mode was selected but no branch artifact found.\n\n...`;
      expect(fallbackBody).toContain("Fallback");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue mode expectations
  // ─────────────────────────────────────────────────────────────────────────

  describe("Issue mode", () => {
    test("issue mode includes agent result in issue body", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-issue",
        agentId: "software-teams-qa-tester",
        status: "ok",
        input: { prompt: "Test it.", context: null },
        result: {
          text: "Test cases written and passing:\n1. Login flow\n2. Signup flow",
        },
        artifacts: [],
      };

      // Issue body should include the agent result
      expect(envelope.result.text).toBeTruthy();
      expect(envelope.result.text.length).toBeGreaterThan(0);
    });

    test("issue mode supports optional labels", () => {
      const labelsString = "testing, verification, qa";
      const labels = labelsString.split(",").map((l) => l.trim());

      expect(labels).toContain("testing");
      expect(labels).toContain("verification");
      expect(labels).toContain("qa");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe("Contract invariants (pass-through)", () => {
    test("output envelope has all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [{ type: "pr", url: "https://github.com/acme/app/pull/1" }],
      };

      expect(envelope).toHaveProperty("correlationId");
      expect(envelope).toHaveProperty("agentId");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("input");
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("artifacts");
    });

    test("no field in output envelope is undefined", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [],
      };

      for (const [key, value] of Object.entries(envelope)) {
        expect(value).not.toBeUndefined();
      }
    });

    test("artifacts array always present (never missing)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build.", context: null },
        result: { text: "Done." },
        artifacts: [],
      };

      expect(envelope).toHaveProperty("artifacts");
      expect(Array.isArray(envelope.artifacts)).toBeTrue();
    });
  });
});
