import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, RepoDescriptor, ChangeRef, ArtifactRef } from "@websitelabs/software-teams";

describe("NodeEnvelope additive repo/changeRef fields (T11 — AC8, AC10, AC11)", () => {
  describe("repo field is optional — six-field invariants unchanged without it", () => {
    test("envelope without repo satisfies all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-plain-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Build it.", context: null },
        result: { text: "Built." },
        artifacts: [],
      };

      expect(envelope).toHaveProperty("correlationId");
      expect(envelope).toHaveProperty("agentId");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("input");
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("artifacts");

      expect(envelope.repo).toBeUndefined();
    });

    test("envelope without repo passes six-field type constraint", () => {
      const six: Readonly<Record<string, unknown>> = {
        correlationId: "run-plain-002",
        agentId: "software-teams-backend",
        status: "error",
        input: { prompt: "Failing task", context: null },
        result: { text: "Error occurred" },
        artifacts: [],
      };
      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(six[key]).toBeDefined();
      }
    });

    test("envelope with repo still satisfies six-field constraint", () => {
      const repo: RepoDescriptor = {
        cloneUrl: "https://github.com/acme/app.git",
        ownerRepo: "acme/app",
        baseBranch: "main",
      };
      const envelope: NodeEnvelope = {
        correlationId: "run-with-repo-001",
        agentId: "software-teams-workspace",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "" },
        artifacts: [],
        repo,
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      expect(envelope.repo).toEqual(repo);
    });
  });

  describe("changeRef field is optional — six-field invariants unchanged without it", () => {
    test("envelope without changeRef satisfies all six fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-no-change-001",
        agentId: "software-teams-programmer",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(envelope.changeRef).toBeUndefined();
      expect(envelope.correlationId).toBe("run-no-change-001");
    });

    test("envelope with changeRef still satisfies six-field constraint", () => {
      const changeRef: ChangeRef = {
        kind: "format-patch",
        patchBase64: Buffer.from("diff --git a/f b/f\n--- a/f\n+++ b/f\n").toString("base64"),
      };
      const envelope: NodeEnvelope = {
        correlationId: "run-with-change-001",
        agentId: "software-teams-programmer",
        status: "ok",
        input: { prompt: "Fix bug", context: null },
        result: { text: "Fixed" },
        artifacts: [],
        changeRef,
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      expect(envelope.changeRef).toEqual(changeRef);
      expect(envelope.changeRef?.kind).toBe("format-patch");
    });
  });

  describe("§4 upstream-context merge — additive fields do not contaminate context", () => {
    test("repo field is NOT folded into input.context by the carry-through pattern", () => {
      const repo: RepoDescriptor = {
        cloneUrl: "https://github.com/acme/app.git",
        ownerRepo: "acme/app",
        baseBranch: "main",
      };
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-001",
        agentId: "software-teams-workspace",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "" },
        artifacts: [],
        repo,
      };

      const downstreamContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const downstream: NodeEnvelope = {
        correlationId: upstream.correlationId,
        agentId: "software-teams-programmer",
        status: "ok",
        input: { prompt: "Do the task", context: downstreamContext },
        result: { text: "" },
        artifacts: [],
        repo: upstream.repo,
      };

      expect(downstream.correlationId).toBe(upstream.correlationId);
      expect(downstream.repo).toBe(repo);

      const ctx = downstream.input.context as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("repo");
      expect(ctx).not.toHaveProperty("changeRef");
    });

    test("changeRef field is NOT folded into input.context by the carry-through pattern", () => {
      const changeRef: ChangeRef = { kind: "format-patch", patchBase64: "abc123" };
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-002",
        agentId: "software-teams-programmer",
        status: "ok",
        input: { prompt: "Implement", context: null },
        result: { text: "Done" },
        artifacts: [],
        changeRef,
      };

      const downstreamContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const ctx = downstreamContext as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("changeRef");
      expect(ctx).toHaveProperty("from", "software-teams-programmer");
    });
  });

  describe("branch artifact type — additive artifact vocabulary", () => {
    test("branch artifact satisfies ArtifactRef type", () => {
      const ref: ArtifactRef = { type: "branch", url: "https://github.com/acme/app/tree/feat/run-abc" };
      expect(ref.type).toBe("branch");
      expect(ref.url).toContain("/tree/");
    });

    test("envelope with branch artifact preserves six-field count when repo is absent", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-branch-001",
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "Summary" },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/st-run-abc12345" }],
      };
      expect(envelope.repo).toBeUndefined();
      expect(envelope.artifacts).toHaveLength(1);
      expect(envelope.artifacts[0]?.type).toBe("branch");
    });

    test("repo + changeRef + branch artifact coexist without conflicts", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-full-001",
        agentId: "software-teams-finaliser",
        status: "ok",
        input: { prompt: "", context: null },
        result: { text: "Run complete" },
        artifacts: [{ type: "branch", url: "https://github.com/acme/app/tree/feat/st-run-abcd1234" }],
        repo: { cloneUrl: "https://github.com/acme/app.git", ownerRepo: "acme/app", baseBranch: "main" },
        changeRef: { kind: "format-patch", patchBase64: "xyz" },
      };

      expect(envelope.correlationId).toBe("run-full-001");
      expect(envelope.repo?.ownerRepo).toBe("acme/app");
      expect(envelope.changeRef?.kind).toBe("format-patch");
      expect(envelope.artifacts[0]?.type).toBe("branch");
    });
  });
});
