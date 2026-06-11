import { describe, test, expect } from "bun:test";
import { validateOwnerRepo, validateBranchName, validateCloneUrl } from "../validate";

// ── validateOwnerRepo ─────────────────────────────────────────────────────────

describe("validateOwnerRepo — valid inputs accepted", () => {
  const valid = [
    "owner/repo",
    "my-org/my-repo",
    "Owner123/Repo.Name",
    "a/b",
    "A-1/B_2",
    "websitelabs/software-teams",
  ];

  for (const v of valid) {
    test(`accepts "${v}"`, () => {
      expect(validateOwnerRepo(v)).toBe(v);
    });
  }
});

describe("validateOwnerRepo — injection-laden and malformed inputs rejected", () => {
  const rejected: Array<[string, string]> = [
    ["no-slash", "must match <owner>/<repo>"],
    ["owner/", "must match <owner>/<repo>"],
    ["/repo", "must match <owner>/<repo>"],
    ["owner/repo/extra", "must match <owner>/<repo>"],
    ["owner repo/name", "must match <owner>/<repo>"],
    ["; rm -rf /", "must match <owner>/<repo>"],
    ["$(id)/repo", "must match <owner>/<repo>"],
    ["`whoami`/repo", "must match <owner>/<repo>"],
    ["owner/repo;ls", "must match <owner>/<repo>"],
    ["owner/repo|cat", "must match <owner>/<repo>"],
    ["owner/repo && bad", "must match <owner>/<repo>"],
    ["../etc/passwd", "must match <owner>/<repo>"],
    ["owner/re po", "must match <owner>/<repo>"],
    ["", "must match <owner>/<repo>"],
  ];

  for (const [input, reason] of rejected) {
    test(`rejects "${input}" (${reason})`, () => {
      expect(() => validateOwnerRepo(input)).toThrow();
    });
  }
});

// ── validateBranchName ────────────────────────────────────────────────────────

describe("validateBranchName — valid inputs accepted", () => {
  const valid = [
    "main",
    "feat/my-feature",
    "fix/issue-123",
    "release/1.0.0",
    "chore/update_deps",
    "wt/agent-one/abcd1234",
    "hotfix.patch",
  ];

  for (const v of valid) {
    test(`accepts "${v}"`, () => {
      expect(validateBranchName(v)).toBe(v);
    });
  }
});

describe("validateBranchName — injection-laden and malformed inputs rejected", () => {
  const rejected: Array<[string, string]> = [
    ["-bad-start", "must not start with -"],
    [".bad-start", "must not start with ."],
    ["", "must not be empty"],
    ["branch with space", "whitespace"],
    ["branch\ttab", "whitespace"],
    ["branch\nnewline", "whitespace"],
    ["feat..bad", "forbidden git ref sequence .."],
    ["branch@{bad}", "forbidden git ref sequence @{"],
    ["locked.lock", ".lock suffix"],
    ["feat;drop", "forbidden characters"],
    ["feat$(id)", "forbidden characters"],
    ["feat`id`", "forbidden characters"],
    ["feat|pipe", "forbidden characters"],
    ["feat&amp", "forbidden characters"],
    ["feat<lt>", "forbidden characters"],
    ["feat>gt", "forbidden characters"],
  ];

  for (const [input, reason] of rejected) {
    test(`rejects "${input}" (${reason})`, () => {
      expect(() => validateBranchName(input)).toThrow();
    });
  }
});

// ── validateCloneUrl ──────────────────────────────────────────────────────────

describe("validateCloneUrl — valid inputs accepted", () => {
  const valid = [
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo",
    "https://gitlab.com/group/subgroup/project",
    "git@github.com:owner/repo.git",
    "git@gitlab.com:owner/repo",
    "git@bitbucket.org:owner/repo.git",
  ];

  for (const v of valid) {
    test(`accepts "${v}"`, () => {
      expect(validateCloneUrl(v)).toBe(v);
    });
  }
});

describe("validateCloneUrl — injection-laden and malformed inputs rejected", () => {
  const rejected: Array<[string, string]> = [
    ["https://github.com/owner/repo;ls", "semicolon injection"],
    ["https://github.com/owner/$(id)", "dollar-paren injection"],
    ["https://github.com/`whoami`/repo", "backtick injection"],
    ["https://github.com/owner|cat /etc/passwd", "pipe injection"],
    ["https://github.com/owner&ls", "ampersand injection"],
    ["https://github.com/owner<redirect", "redirect injection"],
    ["https://github.com/owner>out", "redirect injection"],
    ["https://github.com/owner\\repo", "backslash injection"],
    ["ftp://github.com/owner/repo.git", "unsupported scheme"],
    ["file:///etc/passwd", "unsupported scheme"],
    ["", "empty string"],
    ["not-a-url", "not a URL"],
    ["git@", "incomplete SSH URL"],
    ["https://", "no host"],
    ["https://github.com/owner/repo$BAD", "dollar injection"],
  ];

  for (const [input, reason] of rejected) {
    test(`rejects "${input}" (${reason})`, () => {
      expect(() => validateCloneUrl(input)).toThrow();
    });
  }
});

// ── Parametric boundary table ─────────────────────────────────────────────────

describe("sanitisation boundary table — common injection patterns all three validators reject", () => {
  const injectionProbes = [
    "; rm -rf /",
    "$(rm -rf /)",
    "`rm -rf /`",
    "| cat /etc/passwd",
    "&& curl evil.com",
    "< /dev/urandom",
    "> /tmp/out",
  ];

  for (const probe of injectionProbes) {
    test(`validateOwnerRepo rejects probe: ${probe.slice(0, 30)}`, () => {
      expect(() => validateOwnerRepo(probe)).toThrow();
    });

    test(`validateBranchName rejects probe: ${probe.slice(0, 30)}`, () => {
      expect(() => validateBranchName(probe)).toThrow();
    });

    test(`validateCloneUrl rejects probe: ${probe.slice(0, 30)}`, () => {
      expect(() => validateCloneUrl(probe)).toThrow();
    });
  }
});
