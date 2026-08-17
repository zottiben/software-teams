import { describe, expect, test } from "bun:test";
import { TURN_RESULT_SCHEMA, parseTurnResult } from "../envelope-schema";

describe("TURN_RESULT_SCHEMA", () => {
  test("is a valid, closed JSON Schema object", () => {
    expect(TURN_RESULT_SCHEMA.type).toBe("object");
    expect(TURN_RESULT_SCHEMA.additionalProperties).toBe(false);
    expect(TURN_RESULT_SCHEMA.required).toEqual(["status", "summary", "question"]);
  });

  test("the status enum matches what the node branches on", () => {
    expect(TURN_RESULT_SCHEMA.properties.status.enum).toEqual(["ok", "needs-input", "error"]);
  });

  test("requires a question field without unsupported top-level schema combinators", () => {
    expect(TURN_RESULT_SCHEMA.required).toContain("question");
    expect("allOf" in TURN_RESULT_SCHEMA).toBeFalse();
    expect("oneOf" in TURN_RESULT_SCHEMA).toBeFalse();
    expect("anyOf" in TURN_RESULT_SCHEMA).toBeFalse();
  });

  test("survives JSON.stringify, since it is passed as a CLI argument", () => {
    expect(() => JSON.parse(JSON.stringify(TURN_RESULT_SCHEMA))).not.toThrow();
  });
});

describe("parseTurnResult", () => {
  test("accepts a well-formed result", () => {
    const parsed = parseTurnResult({
      status: "ok",
      summary: "Added the endpoint",
      filesChanged: ["src/api.ts"],
      confidence: 0.9,
    });
    expect(parsed).toEqual({
      status: "ok",
      summary: "Added the endpoint",
      filesChanged: ["src/api.ts"],
      confidence: 0.9,
    });
  });

  test("carries the question on needs-input", () => {
    const parsed = parseTurnResult({
      status: "needs-input",
      summary: "Blocked on a decision",
      question: "Should deletes be soft or hard?",
    });
    expect(parsed?.question).toBe("Should deletes be soft or hard?");
  });

  test("returns null for null structured output", () => {
    // The value is null whenever structured output could not be produced —
    // notably when the agent's tools list omits StructuredOutput, or the run
    // was cut short. The caller falls back to raw text.
    expect(parseTurnResult(null)).toBeNull();
    expect(parseTurnResult(undefined)).toBeNull();
  });

  test("rejects shapes that do not match the contract", () => {
    expect(parseTurnResult("a string")).toBeNull();
    expect(parseTurnResult([])).toBeNull();
    expect(parseTurnResult({ status: "ok" })).toBeNull();
    expect(parseTurnResult({ summary: "no status" })).toBeNull();
    expect(parseTurnResult({ status: "maybe", summary: "bad status" })).toBeNull();
    expect(parseTurnResult({ status: "needs-input", summary: "no question" })).toBeNull();
  });

  test("drops non-string entries from filesChanged rather than trusting them", () => {
    const parsed = parseTurnResult({
      status: "ok",
      summary: "s",
      filesChanged: ["a.ts", 42, null, "b.ts"],
    });
    expect(parsed?.filesChanged).toEqual(["a.ts", "b.ts"]);
  });

  test("omits optional fields that are absent or the wrong type", () => {
    const parsed = parseTurnResult({ status: "ok", summary: "s", confidence: "high" });
    expect(parsed?.confidence).toBeUndefined();
    expect(parsed?.filesChanged).toBeUndefined();
  });
});
