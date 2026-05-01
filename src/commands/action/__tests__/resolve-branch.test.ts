import { describe, test, expect } from "bun:test";
import { resolveBranch } from "../resolve-branch";

describe("resolveBranch", () => {
  test("returns prHeadRef directly when provided", () => {
    const result = resolveBranch({
      prHeadRef: "feature/my-branch",
      prNumber: "42",
      repo: "owner/repo",
    });
    expect(result).toBe("feature/my-branch");
  });

  test("returns null when neither prHeadRef nor prNumber is provided", () => {
    const result = resolveBranch({
      repo: "owner/repo",
    });
    expect(result).toBeNull();
  });

  test("returns null when prNumber is provided but no repo", () => {
    const result = resolveBranch({
      prNumber: "42",
    });
    expect(result).toBeNull();
  });
});
