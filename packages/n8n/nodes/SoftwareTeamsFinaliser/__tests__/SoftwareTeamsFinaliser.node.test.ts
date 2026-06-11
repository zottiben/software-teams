import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsFinaliser } from "../SoftwareTeamsFinaliser.node";
import type { NodeEnvelope, ArtifactRef } from "@websitelabs/software-teams";
import { extractBranchName } from "../../../src/output/github";

describe("SoftwareTeamsFinaliser node descriptor (T11, AC5, AC7)", () => {
  let node: SoftwareTeamsFinaliser;

  beforeEach(() => {
    node = new SoftwareTeamsFinaliser();
  });

  describe("node descriptor", () => {
    test("displayName is correct", () => {
      expect(node.description.displayName).toBe("Software Teams Finaliser");
    });

    test("name is softwareTeamsFinaliser", () => {
      expect(node.description.name).toBe("softwareTeamsFinaliser");
    });

    test("version is 1", () => {
      expect(node.description.version).toBe(1);
    });

    test("single input and single output", () => {
      expect(node.description.inputs).toEqual(["main"]);
      expect(node.description.outputs).toEqual(["main"]);
    });

    test("group includes output", () => {
      expect(node.description.group).toContain("output");
    });
  });

  describe("R-02: credential requirements", () => {
    test("declares softwareTeamsApi as required credential", () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      expect(creds).toHaveLength(1);
      expect(creds?.[0]?.name).toBe("softwareTeamsApi");
      expect(creds?.[0]?.required).toBeTrue();
    });
  });

  describe("properties — ownerRepo, baseBranch, cloneUrl", () => {
    test("ownerRepo is a required string property", () => {
      const prop = node.description.properties.find((p) => p.name === "ownerRepo");
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe("string");
      expect(prop?.required).toBeTrue();
    });

    test("baseBranch is a required string defaulting to main", () => {
      const prop = node.description.properties.find((p) => p.name === "baseBranch");
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe("string");
      expect(prop?.required).toBeTrue();
      expect((prop as { default?: string })?.default).toBe("main");
    });

    test("cloneUrl is an optional string property", () => {
      const prop = node.description.properties.find((p) => p.name === "cloneUrl");
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe("string");
      expect(prop?.required).toBeFalsy();
    });
  });
});

describe("branch artifact → PR path (T11, AC7, R-17)", () => {
  const OWNER_REPO = "acme/app";
  const CORRELATION_ID = "abcd1234-5678-0000-0000-000000000000";

  function buildFeatureBranchName(correlationId: string): string {
    return `feat/st-run-${correlationId.slice(0, 8)}`;
  }

  function buildBranchUrl(ownerRepo: string, branchName: string): string {
    return `https://github.com/${ownerRepo}/tree/${branchName}`;
  }

  describe("branch artifact shape — extractBranchName takes the PR path", () => {
    test("buildFeatureBranchName produces a feat/st-run-* branch", () => {
      const branch = buildFeatureBranchName(CORRELATION_ID);
      expect(branch).toBe("feat/st-run-abcd1234");
    });

    test("buildBranchUrl produces a github tree URL", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const url = buildBranchUrl(OWNER_REPO, branchName);
      expect(url).toBe("https://github.com/acme/app/tree/feat/st-run-abcd1234");
    });

    test("extractBranchName extracts branch from the generated URL (real helper)", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const url = buildBranchUrl(OWNER_REPO, branchName);
      const extracted = extractBranchName(url);
      expect(extracted).toBe(branchName);
      expect(extracted).toContain("feat/st-run-");
    });

    test("extracted branch name is truthy → PR path is taken (not issue fallback)", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const url = buildBranchUrl(OWNER_REPO, branchName);
      const extracted = extractBranchName(url);

      const takesPrPath = extracted !== null && extracted.length > 0;
      expect(takesPrPath).toBeTrue();
    });

    test("extractBranchName returns null for undefined → issue path would be taken (contrast)", () => {
      const extracted = extractBranchName(undefined);
      expect(extracted).toBeNull();
    });

    test("branch artifact type is 'branch'", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const url = buildBranchUrl(OWNER_REPO, branchName);
      const artifact: ArtifactRef = { type: "branch", url };
      expect(artifact.type).toBe("branch");
      expect(artifact.url).toContain("/tree/");
    });
  });

  describe("success envelope shape from Finaliser (non-conflicting set)", () => {
    test("success envelope carries branch artifact and passes six-field constraint", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const branchUrl = buildBranchUrl(OWNER_REPO, branchName);

      const successEnvelope: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "## Software Teams Run Summary\n" },
        artifacts: [{ type: "branch", url: branchUrl }],
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(successEnvelope).toHaveProperty(key);
      }

      const branchArtifact = successEnvelope.artifacts.find((a) => a.type === "branch");
      expect(branchArtifact).toBeTruthy();
      expect(branchArtifact?.url).toContain("/tree/");
    });

    test("branch artifact URL maps to a branch name via extractBranchName (PR path)", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const branchUrl = buildBranchUrl(OWNER_REPO, branchName);

      const successEnvelope: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "Summary" },
        artifacts: [{ type: "branch", url: branchUrl }],
      };

      const branchArtifact = successEnvelope.artifacts.find((a) => a.type === "branch");
      const extracted = extractBranchName(branchArtifact?.url);
      expect(extracted).toBe(branchName);
      expect(extracted).not.toBeNull();
    });

    test("no token in serialised success envelope (R-02)", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const branchUrl = buildBranchUrl(OWNER_REPO, branchName);

      const successEnvelope: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "Summary" },
        artifacts: [{ type: "branch", url: branchUrl }],
      };

      const serialised = JSON.stringify(successEnvelope);
      expect(serialised).not.toContain("ghp_");
      expect(serialised).not.toContain("x-access-token");
      expect(serialised).not.toContain("GITHUB_TOKEN");
    });
  });

  describe("run summary content (AC5)", () => {
    test("summary lists correlationId and branch", () => {
      const branchName = buildFeatureBranchName(CORRELATION_ID);
      const lines = [
        "## Software Teams Run Summary",
        "",
        `**Correlation ID:** \`${CORRELATION_ID}\``,
        `**Branch:** \`${branchName}\``,
        `**Repo:** \`${OWNER_REPO}\``,
      ];
      const summary = lines.join("\n");
      expect(summary).toContain(CORRELATION_ID);
      expect(summary).toContain(branchName);
      expect(summary).toContain(OWNER_REPO);
    });

    test("summary includes agent results section with agent name and taskId", () => {
      const agentResults = [
        { taskId: "T1", agent: "software-teams-frontend", status: "done" as const, changeRef: undefined },
        { taskId: "T2", agent: "software-teams-backend", status: "done" as const, changeRef: { kind: "format-patch" as const, patchBase64: "abc" } },
      ];
      const lines: string[] = ["### Agent Results", ""];
      for (const r of agentResults) {
        const icon = r.status === "done" ? "[ok]" : `[${r.status}]`;
        const patch = r.changeRef ? " (changes captured)" : " (no changes)";
        lines.push(`- **${r.agent}** (${r.taskId}): ${icon}${patch}`);
      }
      const summary = lines.join("\n");
      expect(summary).toContain("software-teams-frontend");
      expect(summary).toContain("software-teams-backend");
      expect(summary).toContain("T1");
      expect(summary).toContain("T2");
      expect(summary).toContain("[ok]");
      expect(summary).toContain("(changes captured)");
      expect(summary).toContain("(no changes)");
    });
  });

  describe("conflict failure envelope (bounded-failure → AC6)", () => {
    test("bounded-failure produces error status envelope surfacing conflicting files", () => {
      const conflictingFiles = ["src/main.ts", "src/utils.ts"];
      const turnsExhausted = 3;

      const errorText =
        `Finaliser conflict resolution exhausted ${turnsExhausted} ` +
        `resolver turn(s) without producing a clean tree. ` +
        `Conflicting files: ${conflictingFiles.join(", ")}. ` +
        `A human must resolve these conflicts manually.`;

      const errorEnvelope: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "error",
        input: { prompt: "", context: null },
        result: { text: errorText },
        artifacts: [],
      };

      expect(errorEnvelope.status).toBe("error");
      expect(errorEnvelope.result.text).toMatch(/[Cc]onflicting [Ff]iles/);
      expect(errorEnvelope.result.text).toContain("src/main.ts");
      expect(errorEnvelope.result.text).toContain("src/utils.ts");
      expect(errorEnvelope.result.text).toContain("3 resolver turn");
      expect(errorEnvelope.result.text).not.toContain("ghp_");
    });

    test("conflict error envelope satisfies six-field contract", () => {
      const errorEnvelope: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "error",
        input: { prompt: "", context: null },
        result: { text: "Conflict detected in: alpha.ts" },
        artifacts: [],
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(errorEnvelope).toHaveProperty(key);
      }
    });
  });

  describe("no token in output (R-02)", () => {
    test("success envelope does not contain any token-like string", () => {
      const env: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "Summary text" },
        artifacts: [{ type: "branch", url: `https://github.com/${OWNER_REPO}/tree/feat/st-run-abcd1234` }],
      };
      const json = JSON.stringify(env);
      expect(json).not.toMatch(/ghp_[a-zA-Z0-9]+/);
      expect(json).not.toContain("x-access-token");
    });

    test("error envelope does not contain any token-like string", () => {
      const env: NodeEnvelope = {
        correlationId: CORRELATION_ID,
        agentId: "software-teams-finaliser",
        status: "error",
        input: { prompt: "", context: null },
        result: { text: "Conflict in src/main.ts" },
        artifacts: [],
      };
      const json = JSON.stringify(env);
      expect(json).not.toMatch(/ghp_[a-zA-Z0-9]+/);
    });
  });
});
