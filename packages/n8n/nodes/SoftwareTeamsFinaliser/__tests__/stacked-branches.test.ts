import { describe, test, expect } from "bun:test";
import {
  buildEpicBranchName,
  buildSliceBranchName,
} from "../SoftwareTeamsFinaliser.node";

// nodifi-data's own guidance: keep branch names short (~35 chars, no ticket
// ref) or Argo will not build a review environment for the PR. A review env is
// where browser-visible behaviour gets checked, so an over-long name silently
// costs the E2E step rather than failing outright.
const ARGO_BRANCH_LIMIT = 35;

const CORRELATION = "epic-NDP-34603-abcdef012345";

describe("epic branch", () => {
  test("is derived from the correlation id", () => {
    expect(buildEpicBranchName(CORRELATION)).toBe("epic/st-epic-NDP");
  });

  test("is stable for the same run", () => {
    expect(buildEpicBranchName(CORRELATION)).toBe(buildEpicBranchName(CORRELATION));
  });

  test("differs between runs", () => {
    expect(buildEpicBranchName("aaaaaaaaaa")).not.toBe(buildEpicBranchName("bbbbbbbbbb"));
  });
});

describe("slice branch", () => {
  test("stays within the review-environment name limit", () => {
    const name = buildSliceBranchName(CORRELATION, "implement-quote-engine-rate-cap");
    expect(name.length).toBeLessThanOrEqual(ARGO_BRANCH_LIMIT);
  });

  test.each([
    ["T1", "simple"],
    ["Task 2: Backend API", "spaces and punctuation"],
    ["FIX/weird__chars!!", "slashes and repeats"],
    ["a".repeat(80), "very long task id"],
  ])("produces a valid git ref for %s (%s)", (taskId) => {
    const name = buildSliceBranchName(CORRELATION, taskId);
    expect(name.length).toBeLessThanOrEqual(ARGO_BRANCH_LIMIT);
    // git refuses refs with spaces, and a trailing or doubled separator is a
    // common source of "cannot lock ref" failures.
    expect(name).not.toMatch(/\s/);
    expect(name).not.toMatch(/-$/);
    expect(name).not.toMatch(/--/);
    expect(name.startsWith("feat/st-")).toBe(true);
  });

  test("distinguishes slices within the same run", () => {
    const a = buildSliceBranchName(CORRELATION, "backend-api");
    const b = buildSliceBranchName(CORRELATION, "frontend-form");
    expect(a).not.toBe(b);
  });

  test("is stable for the same slice, so a re-run pushes the same branch", () => {
    expect(buildSliceBranchName(CORRELATION, "backend-api")).toBe(
      buildSliceBranchName(CORRELATION, "backend-api"),
    );
  });

  test("is not the epic branch", () => {
    expect(buildSliceBranchName(CORRELATION, "anything")).not.toBe(
      buildEpicBranchName(CORRELATION),
    );
  });
});
