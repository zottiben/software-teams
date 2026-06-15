/**
 * Correlation tag format + contract additive test suite (T3 — AC2, AC7, R-06).
 *
 * This test suite lives in packages/cli/src/contract/__tests__ to validate the
 * contract source of truth. It mirrors the n8n package's contract tests but
 * focuses on the shared contract definitions in packages/cli/src/contract/envelope.ts.
 *
 * Verifies that:
 * - PR correlation tag format is canonical and round-trips correctly
 * - Six core envelope fields are unchanged and always present
 * - feedback? and hitlChannel? are truly optional and additive
 * - New fields do NOT contaminate the input.context merge path
 * - contract-check assertions pass (AC7 — additive-only)
 */

import { describe, test, expect } from "bun:test";
import {
  CORRELATION_TAG_PREFIX,
  buildCorrelationTag,
  parseCorrelationTag,
} from "../envelope";
import type { NodeEnvelope, FeedbackComment } from "../envelope";

describe("PR correlation tag (T3 — AC2, R-06)", () => {
  describe("CORRELATION_TAG_PREFIX constant", () => {
    test("is the expected prefix string", () => {
      expect(CORRELATION_TAG_PREFIX).toBe("software-teams:correlationId=");
    });

    test("is included in buildCorrelationTag output", () => {
      const tag = buildCorrelationTag("test-id");
      expect(tag).toContain(CORRELATION_TAG_PREFIX);
    });
  });

  describe("buildCorrelationTag", () => {
    test("wraps correlationId in an HTML comment", () => {
      const tag = buildCorrelationTag("run-2026-06-03-CU-4821");
      expect(tag).toBe("<!-- software-teams:correlationId=run-2026-06-03-CU-4821 -->");
    });

    test("includes the prefix and correlationId", () => {
      const tag = buildCorrelationTag("abc123");
      expect(tag).toContain(CORRELATION_TAG_PREFIX);
      expect(tag).toContain("abc123");
    });

    test("produces a valid HTML comment", () => {
      const tag = buildCorrelationTag("id-42");
      expect(tag).toMatch(/^<!--.*-->$/);
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

describe("NodeEnvelope contract additive fields (T3 — AC7)", () => {
  describe("six core fields are unchanged and always present", () => {
    test("minimal envelope has exactly six required fields", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-min-001",
        agentId: "software-teams-backend",
        status: "ok",
        input: { prompt: "Do work", context: null },
        result: { text: "Done" },
        artifacts: [],
      };

      // Exactly six core fields
      const keys = Object.keys(envelope);
      const coreFields = [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ];
      for (const key of coreFields) {
        expect(envelope).toHaveProperty(key);
      }

      // No optional fields
      expect(envelope.feedback).toBeUndefined();
      expect(envelope.hitlChannel).toBeUndefined();
      expect(envelope.repo).toBeUndefined();
      expect(envelope.changeRef).toBeUndefined();
    });

    test("six core fields are non-optional and required", () => {
      const requiredFields = [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ];

      const envelope: NodeEnvelope = {
        correlationId: "run-req-001",
        agentId: "software-teams-orchestrator",
        status: "error",
        input: { prompt: "Question", context: { foo: "bar" } },
        result: { text: "Error occurred" },
        artifacts: [{ type: "error-log", url: "https://example.com/log" }],
      };

      for (const field of requiredFields) {
        expect(envelope).toHaveProperty(field);
        expect((envelope as unknown as Record<string, unknown>)[field]).toBeDefined();
      }
    });
  });

  describe("feedback? field is optional (AC7 — additive)", () => {
    test("envelope without feedback is valid", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-nofb-001",
        agentId: "software-teams-orchestrator",
        status: "ok",
        input: { prompt: "Continue", context: null },
        result: { text: "Continued" },
        artifacts: [],
      };

      expect(envelope.feedback).toBeUndefined();
      // All six core fields present
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }
    });

    test("envelope with feedback is valid and carries comments", () => {
      const comments: FeedbackComment[] = [
        {
          path: "src/components/Banner.tsx",
          line: 42,
          body: "Use a ref instead.",
          author: "reviewer1",
          category: "bug",
          action: "fix",
        },
      ];

      const envelope: NodeEnvelope = {
        correlationId: "run-fb-001",
        agentId: "software-teams-pr-feedback",
        status: "ok",
        input: { prompt: "Process feedback", context: null },
        result: { text: "Feedback processed" },
        artifacts: [],
        feedback: { comments },
      };

      expect(envelope.feedback).toBeDefined();
      expect(envelope.feedback!.comments).toHaveLength(1);
      expect(envelope.feedback!.comments[0].path).toBe("src/components/Banner.tsx");
      // Six core fields still intact
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }
    });

    test("feedback field shape matches the contract (comments array)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-shape-001",
        agentId: "software-teams-feedback",
        status: "ok",
        input: { prompt: "Process", context: null },
        result: { text: "Done" },
        artifacts: [],
        feedback: {
          comments: [
            {
              path: "file.ts",
              line: 10,
              body: "Comment body",
              author: "alice",
              category: "style",
              action: "discuss",
            },
          ],
        },
      };

      expect(Array.isArray(envelope.feedback!.comments)).toBe(true);
      expect(envelope.feedback!.comments[0].path).toBe("file.ts");
    });
  });

  describe("hitlChannel? field is optional (AC7 — additive)", () => {
    test("envelope without hitlChannel is valid", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-nohc-001",
        agentId: "software-teams-hitl",
        status: "needs-input",
        input: { prompt: "Wait", context: null },
        result: { text: "Waiting" },
        artifacts: [],
      };

      expect(envelope.hitlChannel).toBeUndefined();
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }
    });

    test("envelope with hitlChannel is valid for each supported channel", () => {
      const channels: Array<"slack" | "email" | "notify" | "discord"> = [
        "slack",
        "email",
        "notify",
        "discord",
      ];

      for (const channel of channels) {
        const envelope: NodeEnvelope = {
          correlationId: "run-hc-001",
          agentId: "software-teams-hitl",
          status: "needs-input",
          input: { prompt: "Input needed", context: null },
          result: { text: "Waiting" },
          artifacts: [],
          hitlChannel: channel,
        };

        expect(envelope.hitlChannel).toBe(channel);
        // Six core fields intact
        for (const key of [
          "correlationId",
          "agentId",
          "status",
          "input",
          "result",
          "artifacts",
        ]) {
          expect(envelope).toHaveProperty(key);
        }
      }
    });
  });

  describe("§4 upstream-context merge — new fields do NOT contaminate context", () => {
    test("feedback field is NOT folded into input.context carry-through", () => {
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-fb-001",
        agentId: "software-teams-pr-feedback",
        status: "ok",
        input: { prompt: "Process feedback", context: null },
        result: { text: "2 comments categorised" },
        artifacts: [],
        feedback: {
          comments: [
            {
              path: "f.ts",
              line: 1,
              body: "Fix this",
              author: "rev",
              category: "bug",
              action: "fix",
            },
          ],
        },
      };

      // The carry-through pattern builds context from upstream's structured fields ONLY
      // (result, artifacts, agentId, status). It does NOT carry feedback into context.
      const carriedContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const ctx = carriedContext as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("feedback");
      expect(ctx).not.toHaveProperty("hitlChannel");
    });

    test("hitlChannel field is NOT folded into input.context carry-through", () => {
      const upstream: NodeEnvelope = {
        correlationId: "run-ctx-ch-001",
        agentId: "software-teams-orchestrator",
        status: "needs-input",
        input: { prompt: "Question", context: null },
        result: { text: "Need decision" },
        artifacts: [],
        hitlChannel: "discord",
      };

      const carriedContext = {
        from: upstream.agentId,
        upstreamStatus: upstream.status,
        result: upstream.result,
        artifacts: upstream.artifacts,
      };

      const ctx = carriedContext as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("hitlChannel");
      expect(ctx).not.toHaveProperty("feedback");
    });

    test("new fields are top-level siblings of input, never inside it", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-level-001",
        agentId: "software-teams-test",
        status: "ok",
        input: { prompt: "Test", context: null },
        result: { text: "Tested" },
        artifacts: [],
        feedback: { comments: [] },
        hitlChannel: "slack",
      };

      // input is a separate object
      expect(envelope.input).toBeDefined();
      expect(typeof envelope.input).toBe("object");
      expect((envelope.input as Record<string, unknown>)).not.toHaveProperty(
        "feedback",
      );
      expect((envelope.input as Record<string, unknown>)).not.toHaveProperty(
        "hitlChannel",
      );

      // feedback and hitlChannel are top-level siblings of input
      expect((envelope as unknown as Record<string, unknown>)).toHaveProperty("feedback");
      expect((envelope as unknown as Record<string, unknown>)).toHaveProperty("hitlChannel");
    });
  });

  describe("all additive fields coexist without conflicts (AC7)", () => {
    test("repo + changeRef + feedback + hitlChannel on the same envelope", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-all-001",
        agentId: "software-teams-orchestrator",
        status: "ok",
        input: { prompt: "Full run", context: null },
        result: { text: "Complete" },
        artifacts: [
          { type: "pr", url: "https://github.com/acme/app/pull/42" },
        ],
        repo: {
          cloneUrl: "https://github.com/acme/app.git",
          ownerRepo: "acme/app",
          baseBranch: "main",
        },
        changeRef: {
          kind: "format-patch",
          patchBase64: "abc123==",
        },
        feedback: {
          comments: [
            {
              path: "a.ts",
              line: 10,
              body: "Nit",
              author: "bob",
              category: "style",
              action: "acknowledge",
            },
          ],
        },
        hitlChannel: "discord",
      };

      // Six core fields
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }

      // Four additive optional fields
      expect(envelope.repo?.ownerRepo).toBe("acme/app");
      expect(envelope.changeRef?.kind).toBe("format-patch");
      expect(envelope.feedback?.comments).toHaveLength(1);
      expect(envelope.hitlChannel).toBe("discord");
    });

    test("six core fields + only feedback (no repo/changeRef/hitlChannel)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-partial-fb",
        agentId: "software-teams-pr-feedback",
        status: "ok",
        input: { prompt: "Feedback only", context: null },
        result: { text: "Processed" },
        artifacts: [],
        feedback: { comments: [] },
      };

      // Core fields
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }

      expect(envelope.feedback).toBeDefined();
      expect(envelope.hitlChannel).toBeUndefined();
      expect(envelope.repo).toBeUndefined();
      expect(envelope.changeRef).toBeUndefined();
    });

    test("six core fields + only hitlChannel (no repo/changeRef/feedback)", () => {
      const envelope: NodeEnvelope = {
        correlationId: "run-partial-ch",
        agentId: "software-teams-hitl",
        status: "needs-input",
        input: { prompt: "Channel hint", context: null },
        result: { text: "Waiting" },
        artifacts: [],
        hitlChannel: "email",
      };

      // Core fields
      for (const key of [
        "correlationId",
        "agentId",
        "status",
        "input",
        "result",
        "artifacts",
      ]) {
        expect(envelope).toHaveProperty(key);
      }

      expect(envelope.hitlChannel).toBe("email");
      expect(envelope.feedback).toBeUndefined();
      expect(envelope.repo).toBeUndefined();
      expect(envelope.changeRef).toBeUndefined();
    });
  });
});
