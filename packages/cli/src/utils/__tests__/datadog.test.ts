import { describe, test, expect } from "bun:test";
import { extractDatadogIssue, formatDatadogAsContext, type DatadogIssue } from "../datadog";
import { SCRUB_MARKERS } from "../pii-scrubber";

describe("extractDatadogIssue", () => {
  test("pulls issue ID + US1 API base from a real error-tracking URL", () => {
    // Real-world URL shape from the user's investigation thread.
    const url = "https://app.datadoghq.com/error-tracking?query=env%3Aproduction&refresh_mode=sliding&source=all&sp=[{%22p%22%3A{%22issueId%22%3A%2288e106aa-4cfa-11f1-9f98-da7ad0900002%22}%2C%22i%22%3A%22error-tracking-issue%22}]&from_ts=1778722790466&to_ts=1778809190466&live=true";
    const result = extractDatadogIssue(`Check this: ${url}`);
    expect(result).not.toBeNull();
    expect(result!.issueId).toBe("88e106aa-4cfa-11f1-9f98-da7ad0900002");
    expect(result!.apiBase).toBe("https://api.datadoghq.com");
  });

  test("US5 region URL routes to api.us5.datadoghq.com", () => {
    const url = "https://app.us5.datadoghq.com/error-tracking?sp=%5B%7B%22p%22%3A%7B%22issueId%22%3A%22aabbccdd-1122-3344-5566-778899aabbcc%22%7D%7D%5D";
    const result = extractDatadogIssue(url);
    expect(result).not.toBeNull();
    expect(result!.apiBase).toBe("https://api.us5.datadoghq.com");
    expect(result!.issueId).toBe("aabbccdd-1122-3344-5566-778899aabbcc");
  });

  test("EU region URL routes to api.datadoghq.eu", () => {
    const url = "https://app.datadoghq.eu/error-tracking?sp=%5B%7B%22p%22%3A%7B%22issueId%22%3A%22deadbeef-1234-5678-9abc-def012345678%22%7D%7D%5D";
    const result = extractDatadogIssue(url);
    expect(result).not.toBeNull();
    expect(result!.apiBase).toBe("https://api.datadoghq.eu");
  });

  test("returns null for non-error-tracking Datadog URLs (logs / APM / dashboards out of scope for v1)", () => {
    expect(extractDatadogIssue("https://app.datadoghq.com/logs?query=service%3Afoo")).toBeNull();
    expect(extractDatadogIssue("https://app.datadoghq.com/apm/traces?service=foo")).toBeNull();
    expect(extractDatadogIssue("https://app.datadoghq.com/dashboard/abc-def")).toBeNull();
  });

  test("returns null for non-Datadog URLs", () => {
    expect(extractDatadogIssue("https://example.com/error-tracking?issueId=foo")).toBeNull();
    expect(extractDatadogIssue("https://github.com/owner/repo/issues/1")).toBeNull();
  });

  test("returns null for empty / missing input", () => {
    expect(extractDatadogIssue("")).toBeNull();
    expect(extractDatadogIssue("no url here")).toBeNull();
  });

  test("returns null for error-tracking URL without an issueId", () => {
    expect(extractDatadogIssue("https://app.datadoghq.com/error-tracking?query=env%3Aproduction")).toBeNull();
  });
});

describe("formatDatadogAsContext — PII safety", () => {
  function makeIssue(overrides: Partial<DatadogIssue> = {}): DatadogIssue {
    return {
      id: "88e106aa-4cfa-11f1-9f98-da7ad0900002",
      title: "useNavigation must be used within a NavigationProvider",
      errorType: "Error",
      errorMessage: "useNavigation must be used within a NavigationProvider",
      firstSeen: "2026-05-12T09:14:22Z",
      lastSeen: "2026-05-15T03:26:48Z",
      count: 137,
      service: "nodifi-portal-frontend",
      env: "production",
      version: "2026.05.14-1",
      stacktrace: [
        { file: "resources/packages/nodifi-pages/src/.../NoGuarantor.page.tsx", line: 25, function: "NoGuarantorPage" },
        { file: "resources/packages/nodifi-ui/src/providers/NavigationProvider.tsx", line: 55, function: "useNavigation" },
      ],
      ...overrides,
    };
  }

  test("includes the sanitised header note and the canonical scrub-marker legend", () => {
    const output = formatDatadogAsContext(makeIssue());
    expect(output).toContain("## Datadog Error Context (sanitised)");
    expect(output).toContain("Production PII has been replaced with placeholders");
    // The legend should mention every marker the scrubber can emit.
    for (const marker of SCRUB_MARKERS) {
      expect(output).toContain(`\`${marker}\``);
    }
  });

  test("scrubs email and phone embedded in the error message", () => {
    const dirty = makeIssue({
      errorMessage:
        "Validation failed: invalid email alice@example.com for user_id=98765432, callback to +1 555-123-4567 also failed",
    });
    const output = formatDatadogAsContext(dirty);
    expect(output).toContain("<email>");
    expect(output).toContain("<id>");
    expect(output).toContain("<phone>");
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("98765432");
    expect(output).not.toContain("555-123-4567");
  });

  test("truncates the error message at 500 chars and appends an ellipsis", () => {
    // Use a message shape the scrubber WILL preserve (no PII patterns,
    // no 60+ char alphanumeric run) so we can observe pure truncation.
    // "Word " repeated stays under the long-token threshold because of
    // the spaces — each "word" is short.
    const huge = ("Word " as string).repeat(400); // 5 chars × 400 = 2000 chars
    const output = formatDatadogAsContext(makeIssue({ errorMessage: huge }));
    // The truncated message is 499 chars + an ellipsis, embedded in
    // a code fence. We assert on a representative slice that:
    //   (a) the message body is exactly 500 chars long ending in `…`
    //   (b) NO content past the cap shows up.
    const fenceMatch = output.match(/```\n([\s\S]+?)\n```/);
    expect(fenceMatch).not.toBeNull();
    const body = fenceMatch![1];
    expect(body.length).toBe(500);
    expect(body.endsWith("…")).toBe(true);
  });

  test("limits stacktrace to top 5 frames", () => {
    const tenFrames = Array.from({ length: 10 }, (_, i) => ({
      file: `file${i}.ts`,
      line: i + 1,
      function: `func${i}`,
    }));
    const output = formatDatadogAsContext(makeIssue({ stacktrace: tenFrames }));
    // Headline says "top 5 frames" and frames 0-4 are present, 5-9 are not.
    expect(output).toContain("(top 5 frames)");
    for (let i = 0; i < 5; i++) expect(output).toContain(`file${i}.ts:${i + 1}`);
    for (let i = 5; i < 10; i++) expect(output).not.toContain(`file${i}.ts:${i + 1}`);
  });

  test("no stacktrace → omits the stacktrace section entirely", () => {
    const output = formatDatadogAsContext(makeIssue({ stacktrace: [] }));
    expect(output).not.toContain("### Stacktrace");
  });

  test("formats service/env/version metadata", () => {
    const output = formatDatadogAsContext(makeIssue());
    expect(output).toContain("`nodifi-portal-frontend`");
    expect(output).toContain("env: `production`");
    expect(output).toContain("version: `2026.05.14-1`");
  });
});
