import { describe, test, expect } from "bun:test";
import { extractClickUpId, extractClickUpRef, formatTicketAsContext, type ClickUpTicket } from "../clickup";

describe("extractClickUpRef", () => {
  describe("URL with team-id prefix (regression: issue 6201)", () => {
    test("captures BOTH team ID and custom task ID from `/t/<team>/<task>` form", () => {
      const url = "https://app.clickup.com/t/36826178/NDP-33700";
      const ref = extractClickUpRef(`Clickup Ticket: ${url}`);
      expect(ref).not.toBeNull();
      expect(ref!.teamId).toBe("36826178");
      expect(ref!.taskId).toBe("NDP-33700");
    });

    test("captures markdown-wrapped link with team prefix", () => {
      const ref = extractClickUpRef(
        "See [Ticket](https://app.clickup.com/t/36826178/NDP-33700) for details",
      );
      expect(ref).not.toBeNull();
      expect(ref!.teamId).toBe("36826178");
      expect(ref!.taskId).toBe("NDP-33700");
    });

    test("handles sharing.clickup.com host with team prefix", () => {
      const ref = extractClickUpRef("https://sharing.clickup.com/t/12345/CUSTOM-99");
      expect(ref).not.toBeNull();
      expect(ref!.teamId).toBe("12345");
      expect(ref!.taskId).toBe("CUSTOM-99");
    });
  });

  describe("simple URL (no team prefix)", () => {
    test("captures plain task ID from `/t/<task>` form", () => {
      const ref = extractClickUpRef("https://app.clickup.com/t/abc123");
      expect(ref).not.toBeNull();
      expect(ref!.taskId).toBe("abc123");
      expect(ref!.teamId).toBeUndefined();
    });

    test("does NOT collapse the team-prefix form into the simple form (regression guard)", () => {
      // Pre-fix bug: simple regex `/t/([a-z0-9]+)/i` matched the team
      // ID first and stopped at `/`, capturing `36826178` and never
      // seeing the real task alias.
      const ref = extractClickUpRef("https://app.clickup.com/t/36826178/NDP-33700");
      expect(ref!.taskId).not.toBe("36826178");
      expect(ref!.taskId).toBe("NDP-33700");
    });
  });

  describe("input handling", () => {
    test("returns null when no ClickUp URL is present", () => {
      expect(extractClickUpRef("just some prose")).toBeNull();
      expect(extractClickUpRef("")).toBeNull();
    });

    test("rejects implausibly long IDs (>40 chars task alias, >20 chars simple)", () => {
      const huge = "X".repeat(50);
      expect(extractClickUpRef(`https://app.clickup.com/t/123/${huge}`)).toBeNull();
      expect(extractClickUpRef(`https://app.clickup.com/t/${"a".repeat(30)}`)).toBeNull();
    });
  });
});

describe("extractClickUpId (back-compat shim)", () => {
  test("returns the same string the old extractor would have returned for simple URLs", () => {
    expect(extractClickUpId("https://app.clickup.com/t/abc123")).toBe("abc123");
  });

  test("returns the custom task ID (not the team ID) for the team-prefix form — fixes 6201 regression", () => {
    expect(extractClickUpId("https://app.clickup.com/t/36826178/NDP-33700")).toBe("NDP-33700");
  });
});

describe("formatTicketAsContext — PII safety unchanged", () => {
  function makeTicket(overrides: Partial<ClickUpTicket> = {}): ClickUpTicket {
    return {
      id: "NDP-33700",
      name: "Add field validation to estimated_settlement_date",
      description: "Customer alice@example.com reports the date field accepts past dates",
      status: "in progress",
      priority: "normal",
      acceptanceCriteria: [
        "Reject dates more than 5 years in the past",
        "Notify ops@example.com when validation fails",
      ],
      subtasks: [{ name: "Add Pest test", status: "open" }],
      ...overrides,
    };
  }

  test("ticket bodies routed through scrubPII (regression guard for 0.5.40 behaviour)", () => {
    const formatted = formatTicketAsContext(makeTicket());
    expect(formatted).toContain("<email>");
    expect(formatted).not.toContain("alice@example.com");
    expect(formatted).not.toContain("ops@example.com");
    // Sanitised header must be present so downstream reviewers can audit.
    expect(formatted).toContain("(sanitised)");
  });
});
