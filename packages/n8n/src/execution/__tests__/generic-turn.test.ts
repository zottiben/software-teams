import { describe, expect, test } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import {
  applyTurnAccounting,
  buildGenericHandoff,
  parseOutputSchema,
  resolveToolPolicy,
  resumePolicyFromAudit,
  turnBudget,
} from "../generic-turn";
import {
  projectStructuredOutput,
  stateForProcessOutcome,
  withoutTurnMetadata,
} from "../single-turn";

const upstream: NodeEnvelope = {
  correlationId: "11111111-2222-4333-8444-555555555555",
  agentId: "software-teams-ticket",
  status: "ok",
  input: {
    prompt: "Triage this ticket",
    context: { source: "manual", ticket: { id: "SUP-1" } },
  },
  result: { text: "" },
  artifacts: [],
  budget: { limitUsd: 1, spentUsd: 0.4 },
  audit: [
    {
      at: "2026-06-15T12:00:00.000Z",
      actor: "software-teams-ticket",
      action: "ticket-ingested",
      status: "ok",
    },
  ],
};

describe("generic Claude Code turn policy", () => {
  test("read-only is the default and cannot write, shell, spawn, or use the network", () => {
    expect(resolveToolPolicy("readOnly", "")).toEqual(["Read", "Glob", "Grep"]);
    expect(resolveToolPolicy("readOnly", "")).not.toContain("Write");
    expect(resolveToolPolicy("readOnly", "")).not.toContain("Edit");
    expect(resolveToolPolicy("readOnly", "")).not.toContain("Bash");
    expect(resolveToolPolicy("readOnly", "")).not.toContain("Agent");
    expect(resolveToolPolicy("readOnly", "")).not.toContain("WebFetch");
  });

  test("repository changes require an explicit policy selection", () => {
    expect(resolveToolPolicy("repositoryWrite", "")).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "Bash(git:*)",
      "Bash(bun:*)",
      "Bash(npm:*)",
    ]);
  });

  test("custom policy rejects unknown and nested-agent tools", () => {
    expect(() => resolveToolPolicy("custom", "Read, ImaginaryTool")).toThrow(
      'Unknown Claude Code tool "ImaginaryTool"',
    );
    expect(() => resolveToolPolicy("custom", "Read, Agent")).toThrow(
      "Nested Agent spawning is not available",
    );
  });

  test("a custom schema must be a bounded JSON object schema", () => {
    expect(parseOutputSchema('{"type":"object","properties":{"answer":{"type":"string"}}}'))
      .toEqual({ type: "object", properties: { answer: { type: "string" } } });
    expect(() => parseOutputSchema('{"type":"array"}')).toThrow(
      'Output Schema root type must be "object"',
    );
    expect(() => parseOutputSchema('{"type":"object","allOf":[]}')).toThrow(
      "StructuredOutput rejects top-level schema combinators",
    );
    expect(() => parseOutputSchema("not json")).toThrow("Output Schema must be valid JSON");
    expect(() => parseOutputSchema(" ".repeat(20_001))).toThrow(
      "Output Schema must be 20000 characters or fewer",
    );
  });

  test("handoff preserves the original ticket context, budget, audit, and correlation", () => {
    const handoff = buildGenericHandoff(
      upstream,
      "software-teams-support-triage",
      "Classify this ticket",
    );

    expect(handoff.correlationId).toBe(upstream.correlationId);
    expect(handoff.input.context).toEqual({
      ticketContext: upstream.input.context,
      previous: {
        agentId: "software-teams-ticket",
        status: "ok",
        result: { text: "" },
        artifacts: [],
      },
    });
    expect(handoff.budget).toEqual(upstream.budget);
    expect(handoff.audit).toEqual(upstream.audit);
  });

  test("ticket budget caps each turn to the remaining amount", () => {
    expect(turnBudget(upstream, 0.8)).toBeCloseTo(0.6);
    expect(turnBudget(upstream, 0.2)).toBe(0.2);
    expect(turnBudget({ ...upstream, budget: undefined }, 0.5)).toBe(0.5);
  });

  test("accounting is cumulative and appends a non-secret audit event", () => {
    const result: NodeEnvelope = {
      ...upstream,
      agentId: "software-teams-support-triage",
      result: {
        text: "Likely a product bug",
        data: { classification: "bug" },
      },
      usage: { costUsd: 0.15, turns: 2, models: ["claude-sonnet-5"] },
    };

    const accounted = applyTurnAccounting(result, upstream, {
      policy: "readOnly",
      tools: ["Read", "Glob", "Grep"],
      permissionMode: "dontAsk",
      now: "2026-06-15T12:05:00.000Z",
    });

    expect(accounted.budget).toEqual({ limitUsd: 1, spentUsd: 0.55 });
    expect(accounted.audit?.at(-1)).toEqual({
      at: "2026-06-15T12:05:00.000Z",
      actor: "software-teams-support-triage",
      action: "claude-turn",
      status: "ok",
      details: {
        permissionMode: "dontAsk",
        toolPolicy: "readOnly",
        allowedTools: ["Read", "Glob", "Grep"],
        costUsd: 0.15,
        turns: 2,
      },
    });
    expect(JSON.stringify(accounted.audit)).not.toContain("Likely a product bug");
  });

  test("a non-zero Claude process exit can never be classified as ok", () => {
    expect(stateForProcessOutcome("ok", 1)).toBe("error");
    expect(stateForProcessOutcome("usage-limit", 1)).toBe("usage-limit");
    expect(stateForProcessOutcome("ok", 0)).toBe("ok");
  });

  test("a new process cannot inherit stale cost or session metadata", () => {
    const cleaned = withoutTurnMetadata({
      ...upstream,
      usage: { costUsd: 0.4, turns: 3, models: ["old-model"] },
      sessionId: "old-session",
    });
    expect(cleaned.usage).toBeUndefined();
    expect(cleaned.sessionId).toBeUndefined();
    expect(cleaned.budget).toEqual(upstream.budget);
  });

  test("HITL resume inherits the exact prior tool restriction", () => {
    const withTurn = applyTurnAccounting(upstream, upstream, {
      policy: "readOnly",
      tools: ["Read", "Glob", "Grep"],
      permissionMode: "dontAsk",
      now: "2026-06-15T12:05:00.000Z",
    });
    expect(resumePolicyFromAudit(withTurn)).toEqual({
      policy: "readOnly",
      tools: ["Read", "Glob", "Grep"],
    });
    expect(resumePolicyFromAudit({ ...upstream, audit: undefined })).toEqual({
      policy: "readOnly",
      tools: ["Read", "Glob", "Grep"],
    });
  });

  test("custom structured output remains machine-readable and has a text projection", () => {
    const data = {
      status: "ok",
      summary: "Likely a product bug",
      classification: "bug",
      customerReply: "We are investigating.",
      confidence: 0.84,
    };
    expect(projectStructuredOutput(data, "fallback", true)).toEqual({
      status: "ok",
      text: "Likely a product bug",
      confidence: 0.84,
      data,
    });
  });

  test("does not start a model turn after the cumulative ticket budget is spent", () => {
    const spent = { ...upstream, budget: { limitUsd: 1, spentUsd: 1.01 } };
    expect(turnBudget(spent, 0.5)).toBe(0);
  });
});
