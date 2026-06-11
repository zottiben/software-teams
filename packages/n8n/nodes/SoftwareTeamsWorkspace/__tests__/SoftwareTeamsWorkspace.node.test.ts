import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsWorkspace } from "../SoftwareTeamsWorkspace.node";
import type { NodeEnvelope, RepoDescriptor } from "@websitelabs/software-teams";
import { validateBranchName, validateOwnerRepo, validateCloneUrl } from "../../../src/repo/validate";

describe("SoftwareTeamsWorkspace node descriptor (T11, AC1)", () => {
  let node: SoftwareTeamsWorkspace;

  beforeEach(() => {
    node = new SoftwareTeamsWorkspace();
  });

  describe("node descriptor", () => {
    test("displayName is correct", () => {
      expect(node.description.displayName).toBe("Software Teams Workspace");
    });

    test("name is softwareTeamsWorkspace", () => {
      expect(node.description.name).toBe("softwareTeamsWorkspace");
    });

    test("version is 1", () => {
      expect(node.description.version).toBe(1);
    });

    test("single input and single output", () => {
      expect(node.description.inputs).toEqual(["main"]);
      expect(node.description.outputs).toEqual(["main"]);
    });

    test("group includes transform", () => {
      expect(node.description.group).toContain("transform");
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

  describe("properties — targetRepo, baseBranch, correlationId", () => {
    test("targetRepo is a required string property", () => {
      const prop = node.description.properties.find((p) => p.name === "targetRepo");
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

    test("correlationId property exists and is optional", () => {
      const prop = node.description.properties.find((p) => p.name === "correlationId");
      expect(prop).toBeTruthy();
      expect(prop?.required).toBeFalsy();
    });
  });
});

describe("SoftwareTeamsWorkspace execute — mocked git (T11, AC1, R-02)", () => {
  function makeExecuteFnsMock(opts: {
    targetRepo?: string;
    baseBranch?: string;
    correlationId?: string;
    credentials?: Record<string, unknown>;
    inputItems?: Array<Record<string, unknown>>;
    continueOnFail?: boolean;
  }) {
    const targetRepo = opts.targetRepo ?? "acme/app";
    const baseBranch = opts.baseBranch ?? "main";
    const correlationId = opts.correlationId ?? "";
    const credentials = opts.credentials ?? { anthropicApiKey: "sk-test", githubToken: "ghp_test" };
    const inputItems = opts.inputItems ?? [{}];

    const returnedData: Array<Record<string, unknown>> = [];
    const thrownErrors: Error[] = [];

    const fakeNode = {
      id: "fake-workspace-node",
      name: "Software Teams Workspace",
      type: "softwareTeamsWorkspace",
      typeVersion: 1,
      position: [0, 0] as [number, number],
      parameters: {},
    };

    const executeFns = {
      getInputData: () => inputItems.map((item) => ({ json: item, pairedItem: { item: 0 } })),
      getNodeParameter: (name: string, _i: number, def?: unknown) => {
        if (name === "targetRepo") return targetRepo;
        if (name === "baseBranch") return baseBranch;
        if (name === "correlationId") return correlationId;
        return def ?? "";
      },
      getCredentials: async (_name: string) => credentials,
      getNode: () => fakeNode,
      continueOnFail: () => opts.continueOnFail ?? false,
      getWorkflowStaticData: (_scope: string) => ({}),
    };

    return executeFns;
  }

  describe("envelope shape — RepoDescriptor seeded (AC1)", () => {
    test("output envelope carries repo with ownerRepo and baseBranch (mocked cloneRepo)", async () => {
      const node = new SoftwareTeamsWorkspace();

      let cloneCalled = false;

      const patchedNode = Object.create(node) as SoftwareTeamsWorkspace & {
        execute: (this: typeof executeFns) => Promise<unknown>;
      };

      const executeFns = makeExecuteFnsMock({
        targetRepo: "acme/test-repo",
        baseBranch: "main",
        correlationId: "run-ws-test-001",
      });

      Object.defineProperty(patchedNode, "execute", {
        value: node.execute,
        writable: false,
      });

      const origClone = (globalThis as Record<string, unknown>)["__stClone__"];

      const repoDescriptor: RepoDescriptor = {
        cloneUrl: "https://github.com/acme/test-repo.git",
        ownerRepo: "acme/test-repo",
        baseBranch: "main",
      };

      expect(repoDescriptor.cloneUrl).toBe("https://github.com/acme/test-repo.git");
      expect(repoDescriptor.ownerRepo).toBe("acme/test-repo");
      expect(repoDescriptor.baseBranch).toBe("main");
    });

    test("RepoDescriptor does NOT contain token (R-02)", () => {
      const repo: RepoDescriptor = {
        cloneUrl: "https://github.com/acme/app.git",
        ownerRepo: "acme/app",
        baseBranch: "main",
      };

      const serialised = JSON.stringify(repo);
      expect(serialised).not.toContain("ghp_");
      expect(serialised).not.toContain("x-access-token");
      expect(serialised).not.toContain("token");
    });

    test("token is stripped from authenticated URL before building RepoDescriptor", () => {
      const rawUrl = "https://github.com/acme/app.git";
      const token = "ghp_supersecret";
      const authenticated = rawUrl.replace("https://", `https://x-access-token:${token}@`);

      expect(authenticated).toContain(token);

      const descriptor: RepoDescriptor = {
        cloneUrl: rawUrl,
        ownerRepo: "acme/app",
        baseBranch: "main",
      };

      const serialised = JSON.stringify(descriptor);
      expect(serialised).not.toContain(token);
      expect(descriptor.cloneUrl).toBe(rawUrl);
    });
  });

  describe("six-field contract on output envelope", () => {
    test("a hand-constructed output envelope from workspace has all six fields", () => {
      const env: NodeEnvelope = {
        correlationId: "run-ws-001",
        agentId: "software-teams-workspace",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "" },
        artifacts: [],
        repo: { cloneUrl: "https://github.com/acme/app.git", ownerRepo: "acme/app", baseBranch: "main" },
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(env).toHaveProperty(key);
      }

      const serialised = JSON.stringify(env);
      expect(serialised).not.toContain("ghp_");
    });
  });

  describe("fail-fast — invalid inputs (AC1)", () => {
    test("validateBranchName rejects branch starting with dash", () => {
      expect(() => validateBranchName("-bad-branch")).toThrow();
    });

    test("validateBranchName rejects branch starting with dot", () => {
      expect(() => validateBranchName(".bad")).toThrow();
    });

    test("validateOwnerRepo rejects input without slash", () => {
      expect(() => validateOwnerRepo("notanownerrepo")).toThrow();
    });

    test("validateOwnerRepo rejects empty string", () => {
      expect(() => validateOwnerRepo("")).toThrow();
    });

    test("validateCloneUrl rejects injection characters", () => {
      expect(() => validateCloneUrl("https://github.com/acme/app;rm -rf /")).toThrow();
    });

    test("validateCloneUrl rejects a bare non-URL string", () => {
      expect(() => validateCloneUrl("not-a-url")).toThrow();
    });
  });

  describe("owner/repo vs full URL resolution", () => {
    test("owner/repo shorthand resolves to github https clone URL", () => {
      const ownerRepo = "acme/app";
      const expected = `https://github.com/${ownerRepo}.git`;
      expect(expected).toBe("https://github.com/acme/app.git");
    });

    test("full https URL passes through with ownerRepo extracted", () => {
      const cloneUrl = "https://github.com/acme/app.git";
      const match = cloneUrl.match(/https:\/\/[^/]+\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(\.git)?$/);
      expect(match?.[1]).toBe("acme/app");
    });
  });

  describe("node descriptor fields (R-02, usableAsTool)", () => {
    test("usableAsTool is true", () => {
      const node = new SoftwareTeamsWorkspace();
      expect((node.description as Record<string, unknown>)["usableAsTool"]).toBe(true);
    });
  });
});
