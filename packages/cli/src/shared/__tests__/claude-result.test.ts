import { describe, expect, test } from "bun:test";
import { classifyResult, isRetryableLater, totalCostUsd } from "../claude-result";

describe("classifyResult — terminal states verified against Claude Code 2.1.220", () => {
  test("a clean run is ok", () => {
    expect(classifyResult({ subtype: "success", is_error: false }, "done")).toBe("ok");
  });

  test("budget cap", () => {
    // Observed: subtype error_max_budget_usd, terminal_reason budget_exhausted,
    // result null.
    expect(
      classifyResult(
        {
          subtype: "error_max_budget_usd",
          is_error: true,
          terminal_reason: "budget_exhausted",
          result: null,
        },
        "",
      ),
    ).toBe("budget");
  });

  test("turn cap", () => {
    expect(
      classifyResult(
        { subtype: "error_max_turns", is_error: true, terminal_reason: "max_turns" },
        "",
      ),
    ).toBe("turns");
  });

  test("usage-limit wording is classified as usage-limit, not error", () => {
    // The distinction that matters for an unattended queue: the ticket is fine,
    // the allowance is not.
    for (const text of [
      "You've hit your session limit. Resets at 3pm.",
      "You've hit your weekly limit",
      "usage limit reached",
    ]) {
      expect(classifyResult({ is_error: true }, text)).toBe("usage-limit");
    }
  });

  test("a 429 is a usage limit even without matching prose", () => {
    expect(classifyResult({ is_error: true, api_error_status: 429 }, "")).toBe("usage-limit");
  });

  test("auth failures are distinguished from generic errors", () => {
    for (const text of [
      "Not logged in · Please run /login",
      "Login expired · run /login to renew",
      "Failed to authenticate. API Error: 401 OAuth access token is invalid.",
    ]) {
      expect(classifyResult({ is_error: true }, text)).toBe("auth");
    }
    expect(classifyResult({ is_error: true, api_error_status: 401 }, "")).toBe("auth");
  });

  test("an unrecognised failure stays a plain error", () => {
    expect(classifyResult({ is_error: true }, "something exploded")).toBe("error");
  });

  test("auth wins over usage-limit when both could match", () => {
    // An expired login is not something waiting will fix, so it must not be
    // classified as retryable.
    const state = classifyResult({ is_error: true }, "Login expired. You've hit your limit.");
    expect(state).toBe("auth");
    expect(isRetryableLater(state)).toBe(false);
  });

  test("a missing payload with clean text is ok", () => {
    expect(classifyResult(undefined, "fine")).toBe("ok");
  });
});

describe("isRetryableLater", () => {
  test("only usage-limit clears on its own", () => {
    expect(isRetryableLater("usage-limit")).toBe(true);
    // Retrying these unchanged just burns the allowance again.
    for (const state of ["budget", "turns", "error", "auth", "ok", "needs-input"] as const) {
      expect(isRetryableLater(state)).toBe(false);
    }
  });
});

describe("totalCostUsd", () => {
  test("reads the reported figure, defaulting to zero", () => {
    expect(totalCostUsd({ total_cost_usd: 1.25 })).toBe(1.25);
    expect(totalCostUsd({})).toBe(0);
    expect(totalCostUsd(undefined)).toBe(0);
  });
});
