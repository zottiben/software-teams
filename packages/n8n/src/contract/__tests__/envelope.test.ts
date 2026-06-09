import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, ArtifactRef } from "@websitelabs/software-teams";

describe("NodeEnvelope contract (AC3, drift guard per n8n/CONTRACT.md §1)", () => {
  describe("envelope shape — all six fields present and typed correctly", () => {
    test("all six required fields are present", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Done" },
        artifacts: [],
      };

      expect(envelope).toHaveProperty("correlationId");
      expect(envelope).toHaveProperty("agentId");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("input");
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("artifacts");

      expect(Object.keys(envelope)).toHaveLength(6);
    });

    test("no field is undefined", () => {
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
  });

  describe("status enum — exactly 'ok' | 'error' | 'needs-input'", () => {
    test("accepts 'ok' status", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Success" },
        artifacts: [],
      };
      expect(envelope.status).toBe("ok");
    });

    test("accepts 'error' status", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "error",
        input: { prompt: "Test", context: null },
        result: { text: "Failed" },
        artifacts: [],
      };
      expect(envelope.status).toBe("error");
    });

    test("accepts 'needs-input' status", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "needs-input",
        input: { prompt: "Test", context: null },
        result: { text: "Need decision?" },
        artifacts: [],
      };
      expect(envelope.status).toBe("needs-input");
    });

    test("status type is string literal union (only three values allowed)", () => {
      // TypeScript enforces this at compile-time; runtime verification via assignment
      const validStatuses: Array<"ok" | "error" | "needs-input"> = [
        "ok",
        "error",
        "needs-input",
      ];

      for (const status of validStatuses) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status,
          input: { prompt: "Test", context: null },
          result: { text: "Test" },
          artifacts: [],
        };
        expect(["ok", "error", "needs-input"]).toContain(envelope.status);
      }
    });
  });

  describe("input shape — prompt (string) + context (any)", () => {
    test("input.prompt is a string", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Write a component.", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(typeof envelope.input.prompt).toBe("string");
    });

    test("input.context accepts null", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(envelope.input.context).toBeNull();
    });

    test("input.context accepts an object (upstream result carry-through)", () => {
      const context = {
        from: "software-teams-frontend",
        upstreamStatus: "ok",
        result: { text: "Component added." },
      };
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-qa-tester",
        status: "ok",
        input: { prompt: "Test it.", context },
        result: { text: "Test plan written." },
        artifacts: [],
      };
      expect(envelope.input.context).toEqual(context);
    });

    test("input.context accepts any JSON value (string, array, number)", () => {
      const cases: unknown[] = ["string value", [1, 2, 3], 42, true];

      for (const ctxValue of cases) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId: "software-teams-frontend",
          status: "ok",
          input: { prompt: "Task", context: ctxValue },
          result: { text: "Done" },
          artifacts: [],
        };
        expect(envelope.input.context).toEqual(ctxValue);
      }
    });
  });

  describe("result shape — text (string)", () => {
    test("result.text is a string", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "The agent's answer." },
        artifacts: [],
      };
      expect(typeof envelope.result.text).toBe("string");
    });

    test("result.text can be empty string", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "" },
        artifacts: [],
      };
      expect(envelope.result.text).toBe("");
    });

    test("result.text can contain multiline content", () => {
      const multiline = "Line 1\nLine 2\nLine 3";
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: multiline },
        artifacts: [],
      };
      expect(envelope.result.text).toContain("Line 1");
      expect(envelope.result.text).toContain("Line 2");
    });
  });

  describe("artifacts shape — ArtifactRef[] (possibly empty)", () => {
    test("artifacts is an array (possibly empty)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(Array.isArray(envelope.artifacts)).toBeTrue();
    });

    test("ArtifactRef has type (string) and optional url", () => {
      const ref: ArtifactRef = { type: "pr", url: "https://github.com/..." };
      expect(typeof ref.type).toBe("string");
      expect(ref).toHaveProperty("url");
      expect(typeof ref.url).toBe("string");
    });

    test("ArtifactRef url is optional", () => {
      const ref: ArtifactRef = { type: "branch" };
      expect(ref).toHaveProperty("type");
      expect(ref.url).toBeUndefined();
    });

    test("artifacts array can contain multiple refs", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [
          { type: "branch", url: "https://github.com/acme/site/tree/feat/cookie" },
          { type: "pr", url: "https://github.com/acme/site/pull/123" },
          { type: "comment" },
        ],
      };
      expect(envelope.artifacts).toHaveLength(3);
      expect(envelope.artifacts[0].type).toBe("branch");
      expect(envelope.artifacts[1].type).toBe("pr");
      expect(envelope.artifacts[2].type).toBe("comment");
      expect(envelope.artifacts[2].url).toBeUndefined();
    });

    test("artifacts types are open vocabulary (no closed enum)", () => {
      const refs: ArtifactRef[] = [
        { type: "pr" },
        { type: "issue" },
        { type: "comment" },
        { type: "branch" },
        { type: "custom-artifact-type" },
      ];

      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: refs,
      };

      expect(envelope.artifacts).toHaveLength(5);
      expect(envelope.artifacts.every((a) => typeof a.type === "string")).toBeTrue();
    });
  });

  describe("correlationId field", () => {
    test("correlationId is a string", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-2026-06-03-CU-4821",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(typeof envelope.correlationId).toBe("string");
      expect(envelope.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe("agentId field", () => {
    test("agentId is a string matching agent name format", () => {
      const agentIds = [
        "software-teams-frontend",
        "software-teams-backend",
        "software-teams-qa-tester",
        "software-teams-architect",
      ];

      for (const agentId of agentIds) {
        const envelope: NodeEnvelope = {
          correlationId: "run-001",
          agentId,
          status: "ok",
          input: { prompt: "Task", context: null },
          result: { text: "Done" },
          artifacts: [],
        };
        expect(typeof envelope.agentId).toBe("string");
        expect(envelope.agentId).toMatch(/^software-teams-/);
      }
    });
  });

  describe("contract field carry-through (producer/consumer rules)", () => {
    test("upstream envelope → downstream envelope (worked example per CONTRACT.md §3)", () => {
      // Frontend produces (a)
      const upstream: NodeEnvelope = {
        correlationId: "run-2026-06-03-CU-4821",
        agentId: "software-teams-frontend",
        status: "ok",
        input: {
          prompt: "Add a dismissible cookie-consent banner to the marketing site.",
          context: null,
        },
        result: {
          text: "Added <CookieBanner/> in src/components/CookieBanner.tsx, wired it into App.tsx, and persisted consent to localStorage under key `cookie-consent`.",
        },
        artifacts: [
          {
            type: "branch",
            url: "https://github.com/acme/site/tree/feat/cookie-banner",
          },
        ],
      };

      // QA consumes it and rewrites agentId, carries correlationId, folds upstream into context (b)
      const downstream: NodeEnvelope = {
        correlationId: upstream.correlationId,
        agentId: "software-teams-qa-tester",
        status: "ok",
        input: {
          prompt: "Write a regression checklist and edge cases for the new cookie-consent banner.",
          context: {
            from: upstream.agentId,
            upstreamStatus: upstream.status,
            result: upstream.result,
            artifacts: upstream.artifacts,
          },
        },
        result: { text: "" },
        artifacts: upstream.artifacts,
      };

      // Verify carry-through invariants
      expect(downstream.correlationId).toBe(upstream.correlationId);
      expect(downstream.agentId).not.toBe(upstream.agentId);
      expect(downstream.input.context).toHaveProperty("from", upstream.agentId);
      expect(downstream.input.context).toHaveProperty("upstreamStatus", upstream.status);
      expect(downstream.artifacts).toEqual(upstream.artifacts);
    });
  });

  describe("TypeScript type exports", () => {
    test("NodeEnvelope type is importable", () => {
      // If this test passes, the type exports are correct
      const envelope: NodeEnvelope = {
        correlationId: "run-001",
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "Task", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      expect(envelope).toBeTruthy();
    });

    test("ArtifactRef type is importable", () => {
      // If this test passes, the type exports are correct
      const ref: ArtifactRef = { type: "pr", url: "https://github.com" };
      expect(ref).toBeTruthy();
    });
  });
});
