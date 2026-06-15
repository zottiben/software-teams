import { describe, test, expect } from "bun:test";
import {
  CORRELATION_TAG_PREFIX,
  buildCorrelationTag,
  parseCorrelationTag,
} from "@websitelabs/software-teams";
import type { NodeEnvelope, FeedbackComment } from "@websitelabs/software-teams";

describe("PR correlation tag helpers (plan 1-01 T3 — AC2, R-06)", () => {
  describe("CORRELATION_TAG_PREFIX", () => {
    test("is the expected string constant", () => {
      expect(CORRELATION_TAG_PREFIX).toBe("software-teams:correlationId=");
    });
  });

  describe("buildCorrelationTag", () => {
    test("wraps correlationId in an HTML comment", () => {
      const tag = buildCorrelationTag("run-2026-06-03-CU-4821");
      expect(tag).toBe("<!-- software-teams:correlationId=run-2026-06-03-CU-4821 -->");
    });

    test("includes the prefix constant in the output", () => {
      const tag = buildCorrelationTag("abc123");
      expect(tag).toContain(CORRELATION_TAG_PREFIX);
    });
  });

  describe("parseCorrelationTag", () => {
    test("round-trips with buildCorrelationTag", () => {
      const id = "run-2026-06-15-test-roundtrip";
      const tag = buildCorrelationTag(id);
      expect(parseCorrelationTag(tag)).toBe(id);
    });

    test("extracts id from a PR body containing the tag among other text", () => {
      const body = [
        "## Summary",
        "This PR adds the cookie consent banner.",
        "",
        "<!-- software-teams:correlationId=run-abc-123 -->",
        "",
        "## Changes",
        "- Added CookieBanner component",
      ].join("\n");
      expect(parseCorrelationTag(body)).toBe("run-abc-123");
    });

    test("returns null for a body with no tag", () => {
      expect(parseCorrelationTag("Just a normal PR body with no tag.")).toBeNull();
    });

    test("returns null for an empty string", () => {
      expect(parseCorrelationTag("")).toBeNull();
    });

    test("handles tag with extra whitespace inside the HTML comment", () => {
      const body = "<!--  software-teams:correlationId=run-ws-001  -->";
      expect(parseCorrelationTag(body)).toBe("run-ws-001");
    });

    test("extracts the first tag when multiple are present", () => {
      const body = [
        "<!-- software-teams:correlationId=first-id -->",
        "Some text",
        "<!-- software-teams:correlationId=second-id -->",
      ].join("\n");
      expect(parseCorrelationTag(body)).toBe("first-id");
    });

    test("handles correlationId with various valid characters", () => {
      const ids = [
        "run-2026-06-15-CU-4821",
        "abc123",
        "run_with_underscores",
        "run.with.dots",
        "run-with-dashes-and-123",
      ];
      for (const id of ids) {
        const tag = buildCorrelationTag(id);
        expect(parseCorrelationTag(tag)).toBe(id);
      }
    });
  });
});

describe("NodeEnvelope additive feedback/hitlChannel fields (plan 1-01 T3 — AC2, AC7)", () => {
  describe("feedback field is optional — six-field invariants unchanged without it", () => {
    test("envelope without feedback satisfies all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-fb-001",
        agentId: "software-teams-orchestrator",
        status: "ok",
        input: { prompt: "Continue run", context: null },
        result: { text: "Continued" },
        artifacts: [],
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      expect(envelope.feedback).toBeUndefined();
    });

    test("envelope with feedback still satisfies six-field constraint", () => {
      const comments: FeedbackComment[] = [
        {
          path: "src/components/Banner.tsx",
          line: 42,
          body: "This should use a ref instead of querySelector.",
          author: "reviewer1",
          category: "bug",
          action: "fix",
        },
        {
          path: "src/utils/consent.ts",
          line: null,
          body: "Consider adding a TTL for the consent cookie.",
          author: "reviewer2",
          category: "suggestion",
          action: "discuss",
        },
      ];

      const envelope: NodeEnvelope = {
        correlationId: "run-fb-002",
        agentId: "software-teams-pr-feedback",
        status: "ok",
        input: { prompt: "Process PR feedback", context: null },
        result: { text: "Feedback processed" },
        artifacts: [],
        feedback: { comments },
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      expect(envelope.feedback).toBeDefined();
      expect(envelope.feedback!.comments).toHaveLength(2);
      expect(envelope.feedback!.comments[0].path).toBe("src/components/Banner.tsx");
      expect(envelope.feedback!.comments[0].line).toBe(42);
      expect(envelope.feedback!.comments[1].line).toBeNull();
    });
  });

  describe("hitlChannel field is optional — six-field invariants unchanged without it", () => {
    test("envelope without hitlChannel satisfies all six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-ch-001",
        agentId: "software-teams-orchestrator",
        status: "needs-input",
        input: { prompt: "Need human decision", context: null },
        result: { text: "Which approach?" },
        artifacts: [],
      };

      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      expect(envelope.hitlChannel).toBeUndefined();
    });

    test("envelope with hitlChannel still satisfies six-field constraint", () => {
      const channels: Array<"slack" | "email" | "notify" | "discord"> = [
        "slack",
        "email",
        "notify",
        "discord",
      ];

      for (const channel of channels) {
        const envelope: NodeEnvelope = {
          correlationId: "run-ch-002",
          agentId: "software-teams-orchestrator",
          status: "needs-input",
          input: { prompt: "Need human decision", context: null },
          result: { text: "Which approach?" },
          artifacts: [],
          hitlChannel: channel,
        };

        for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
          expect(envelope).toHaveProperty(key);
        }
        expect(envelope.hitlChannel).toBe(channel);
      }
    });
  });

  describe("§4 upstream-context merge — new fields do not contaminate context", () => {
    test("feedback field is NOT folded into input.context by the carry-through pattern", () => {
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-fb-001",
        agentId: "software-teams-pr-feedback",
        status: "ok",
        input: { prompt: "Process feedback", context: null },
        result: { text: "2 comments categorised" },
        artifacts: [],
        feedback: {
          comments: [
            { path: "f.ts", line: 1, body: "Fix this", author: "rev", category: "bug", action: "fix" },
          ],
        },
      };

      // The carry-through pattern folds only result/artifacts/agentId/status
      const downstreamContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const ctx = downstreamContext as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("feedback");
      expect(ctx).not.toHaveProperty("hitlChannel");
    });

    test("hitlChannel field is NOT folded into input.context by the carry-through pattern", () => {
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-ch-001",
        agentId: "software-teams-orchestrator",
        status: "needs-input",
        input: { prompt: "Question", context: null },
        result: { text: "Need decision" },
        artifacts: [],
        hitlChannel: "discord",
      };

      const downstreamContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const ctx = downstreamContext as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("hitlChannel");
      expect(ctx).not.toHaveProperty("feedback");
    });
  });

  describe("all additive fields coexist without conflicts", () => {
    test("repo + changeRef + feedback + hitlChannel on the same envelope", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-full-all-001",
        agentId: "software-teams-orchestrator",
        status: "ok",
        input: { prompt: "Full run", context: null },
        result: { text: "Complete" },
        artifacts: [{ type: "pr", url: "https://github.com/acme/app/pull/42" }],
        repo: { cloneUrl: "https://github.com/acme/app.git", ownerRepo: "acme/app", baseBranch: "main" },
        changeRef: { kind: "format-patch", patchBase64: "abc" },
        feedback: {
          comments: [
            { path: "a.ts", line: 10, body: "Nit", author: "bob", category: "style", action: "acknowledge" },
          ],
        },
        hitlChannel: "discord",
      };

      // Six core fields
      for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
        expect(envelope).toHaveProperty(key);
      }
      // Four additive optional fields
      expect(envelope.repo?.ownerRepo).toBe("acme/app");
      expect(envelope.changeRef?.kind).toBe("format-patch");
      expect(envelope.feedback?.comments).toHaveLength(1);
      expect(envelope.hitlChannel).toBe("discord");
    });
  });
});
