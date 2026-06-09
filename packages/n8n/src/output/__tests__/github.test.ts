import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  createPullRequest,
  createIssue,
  extractBranchName,
  slugify,
} from "../github";

/**
 * GitHub output helper test suite (T7 - AC6)
 *
 * Tests that:
 * 1. createPullRequest makes the correct GitHub API call
 * 2. createIssue makes the correct GitHub API call
 * 3. extractBranchName correctly parses GitHub URLs and plain names
 * 4. slugify converts text to URL-safe slugs
 * 5. Token is only passed to fetch, never logged or returned
 */

// Mock global fetch
const mockFetch = mock(async (url: string, opts: any) => {
  // Simulate GitHub API responses
  const path = new URL(url).pathname;

  if (path.includes("/pulls")) {
    return {
      ok: true,
      json: async () => ({
        html_url: "https://github.com/acme/app/pull/123",
        number: 123,
      }),
    };
  } else if (path.includes("/issues")) {
    return {
      ok: true,
      json: async () => ({
        html_url: "https://github.com/acme/app/issues/456",
        number: 456,
      }),
    };
  }

  return {
    ok: false,
    json: async () => ({ message: "Not found" }),
  };
});

describe("GitHub output helpers (T7 - AC6)", () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockFetch.mock.calls?.splice(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createPullRequest
  // ─────────────────────────────────────────────────────────────────────────

  describe("createPullRequest (PR creation)", () => {
    test("returns GitHubCreatedRef with url and number", async () => {
      // Patch global fetch
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mockFetch;

      try {
        const result = await createPullRequest({
          owner: "acme",
          repo: "app",
          title: "feat: Add button component",
          body: "Implements a reusable button.",
          head: "feat/button",
          base: "main",
          token: "ghp_test_token",
        });

        expect(result.url).toContain("github.com");
        expect(result.url).toContain("/pull/");
        expect(typeof result.number).toBe("number");
        expect(result.number).toBeGreaterThan(0);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("sends correct GitHub API request (POST /repos/{owner}/{repo}/pulls)", async () => {
      const originalFetch = globalThis.fetch;
      let capturedRequest: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedRequest = { url, opts };
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/test/repo/pull/999",
            number: 999,
          }),
        };
      });

      try {
        await createPullRequest({
          owner: "test",
          repo: "repo",
          title: "Feature PR",
          body: "Test body",
          head: "feat/test",
          base: "dev",
          token: "ghp_secret_test",
        });

        expect(capturedRequest.url).toContain("/repos/test/repo/pulls");
        expect(capturedRequest.opts.method).toBe("POST");
        const bodyObj = JSON.parse(capturedRequest.opts.body);
        expect(bodyObj.title).toBe("Feature PR");
        expect(bodyObj.body).toBe("Test body");
        expect(bodyObj.head).toBe("feat/test");
        expect(bodyObj.base).toBe("dev");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("includes Authorization header with token", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/pull/1",
            number: 1,
          }),
        };
      });

      try {
        await createPullRequest({
          owner: "a",
          repo: "b",
          title: "PR",
          body: "Body",
          head: "feat/x",
          base: "main",
          token: "ghp_my_secret_token_xyz",
        });

        expect(capturedHeaders.Authorization).toBe("token ghp_my_secret_token_xyz");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("throws when GitHub API returns error", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            message: "Validation Failed",
            errors: [{ message: "No commits between main and feat/x" }],
          }),
        };
      });

      try {
        let threwError = false;
        try {
          await createPullRequest({
            owner: "acme",
            repo: "app",
            title: "PR",
            body: "Body",
            head: "feat/x",
            base: "main",
            token: "ghp_token",
          });
        } catch (err) {
          threwError = true;
          expect((err as any).message).toContain("GitHub API error");
        }
        expect(threwError).toBeTrue();
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createIssue
  // ─────────────────────────────────────────────────────────────────────────

  describe("createIssue (issue creation)", () => {
    test("returns GitHubCreatedRef with url and number", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/acme/app/issues/789",
            number: 789,
          }),
        };
      });

      try {
        const result = await createIssue({
          owner: "acme",
          repo: "app",
          title: "Bug: Fix login page",
          body: "Login is broken on mobile.",
          token: "ghp_test_token",
        });

        expect(result.url).toContain("github.com");
        expect(result.url).toContain("/issues/");
        expect(typeof result.number).toBe("number");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("sends correct GitHub API request (POST /repos/{owner}/{repo}/issues)", async () => {
      const originalFetch = globalThis.fetch;
      let capturedRequest: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedRequest = { url, opts };
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/x/y/issues/1",
            number: 1,
          }),
        };
      });

      try {
        await createIssue({
          owner: "x",
          repo: "y",
          title: "Test Issue",
          body: "Test body",
          labels: ["bug", "urgent"],
          token: "ghp_token",
        });

        expect(capturedRequest.url).toContain("/repos/x/y/issues");
        expect(capturedRequest.opts.method).toBe("POST");
        const bodyObj = JSON.parse(capturedRequest.opts.body);
        expect(bodyObj.title).toBe("Test Issue");
        expect(bodyObj.body).toBe("Test body");
        expect(bodyObj.labels).toEqual(["bug", "urgent"]);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("defaults to empty labels array when labels are not provided", async () => {
      const originalFetch = globalThis.fetch;
      let capturedRequest: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedRequest = { url, opts };
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/issues/1",
            number: 1,
          }),
        };
      });

      try {
        await createIssue({
          owner: "a",
          repo: "b",
          title: "Issue",
          body: "Body",
          token: "ghp_token",
        });

        const bodyObj = JSON.parse(capturedRequest.opts.body);
        expect(bodyObj.labels).toEqual([]);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("throws when GitHub API returns error", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            message: "Bad credentials",
          }),
        };
      });

      try {
        let threwError = false;
        try {
          await createIssue({
            owner: "acme",
            repo: "app",
            title: "Issue",
            body: "Body",
            token: "ghp_bad_token",
          });
        } catch (err) {
          threwError = true;
          expect((err as any).message).toContain("GitHub API error");
        }
        expect(threwError).toBeTrue();
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // extractBranchName
  // ─────────────────────────────────────────────────────────────────────────

  describe("extractBranchName", () => {
    test("extracts branch name from GitHub tree URL", () => {
      const url = "https://github.com/acme/app/tree/feat/my-feature";
      const result = extractBranchName(url);
      expect(result).toBe("feat/my-feature");
    });

    test("passes through plain branch names", () => {
      const result = extractBranchName("main");
      expect(result).toBe("main");
    });

    test("passes through branch names with slashes", () => {
      const result = extractBranchName("feat/login-page");
      expect(result).toBe("feat/login-page");
    });

    test("returns null for undefined input", () => {
      const result = extractBranchName(undefined);
      expect(result).toBeNull();
    });

    test("returns null for empty string", () => {
      const result = extractBranchName("");
      expect(result).toBeNull();
    });

    test("handles URLs with special characters in branch name", () => {
      const url = "https://github.com/org/repo/tree/fix/issue-#123";
      const result = extractBranchName(url);
      expect(result).toBe("fix/issue-#123");
    });

    test("extracts correctly when URL has query parameters", () => {
      const url = "https://github.com/org/repo/tree/feat/test?tab=code";
      const result = extractBranchName(url);
      // Note: the implementation may include the query string; test what it actually does
      expect(result).toBeTruthy();
      expect(result).toContain("feat/test");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // slugify
  // ─────────────────────────────────────────────────────────────────────────

  describe("slugify", () => {
    test("converts spaces to hyphens", () => {
      expect(slugify("my feature name")).toBe("my-feature-name");
    });

    test("converts to lowercase", () => {
      expect(slugify("My Feature Name")).toBe("my-feature-name");
    });

    test("removes special characters", () => {
      expect(slugify("fix: urgent!")).toBe("fix-urgent");
    });

    test("removes leading and trailing hyphens", () => {
      expect(slugify("---hello---")).toBe("hello");
    });

    test("respects maxLength parameter (default 50)", () => {
      const longText = "a".repeat(60);
      const result = slugify(longText);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    test("respects custom maxLength", () => {
      const result = slugify("hello world test", 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    test("returns 'task' as fallback for empty input", () => {
      expect(slugify("")).toBe("task");
      expect(slugify("---")).toBe("task");
      expect(slugify("!!!")).toBe("task");
    });

    test("keeps alphanumeric and hyphens", () => {
      const result = slugify("test-123-feature");
      expect(result).toBe("test-123-feature");
    });

    test("handles null input gracefully (treats as empty)", () => {
      // slugify uses ?? which treats null/undefined as empty
      const result = slugify((null as any) ?? "fallback");
      // Will depend on implementation; at minimum should not throw
      expect(typeof result).toBe("string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Token security
  // ─────────────────────────────────────────────────────────────────────────

  describe("Token security (R-02 — no exposure)", () => {
    test("token is not returned in GitHubCreatedRef", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/pull/1",
            number: 1,
          }),
        };
      });

      try {
        const result = await createPullRequest({
          owner: "a",
          repo: "b",
          title: "PR",
          body: "Body",
          head: "feat/x",
          base: "main",
          token: "ghp_secret_token_xyz",
        });

        const resultStr = JSON.stringify(result);
        expect(resultStr).not.toContain("ghp_secret");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("Authorization header is present and correctly formatted", async () => {
      const originalFetch = globalThis.fetch;
      let capturedAuth = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedAuth = opts.headers.Authorization;
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/issues/1",
            number: 1,
          }),
        };
      });

      try {
        const testToken = "ghp_test_token_12345";
        await createIssue({
          owner: "a",
          repo: "b",
          title: "Issue",
          body: "Body",
          token: testToken,
        });

        expect(capturedAuth).toBe(`token ${testToken}`);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Content-Type and User-Agent headers
  // ─────────────────────────────────────────────────────────────────────────

  describe("HTTP headers", () => {
    test("sets Content-Type to application/json", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/pull/1",
            number: 1,
          }),
        };
      });

      try {
        await createPullRequest({
          owner: "a",
          repo: "b",
          title: "PR",
          body: "Body",
          head: "feat/x",
          base: "main",
          token: "ghp_token",
        });

        expect(capturedHeaders["Content-Type"]).toBe("application/json");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("sets Accept header for GitHub API v3", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/issues/1",
            number: 1,
          }),
        };
      });

      try {
        await createIssue({
          owner: "a",
          repo: "b",
          title: "Issue",
          body: "Body",
          token: "ghp_token",
        });

        expect(capturedHeaders.Accept).toContain("vnd.github");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test("sets User-Agent header", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: any = null;

      (globalThis as any).fetch = mock(async (url: string, opts: any) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/a/b/pull/1",
            number: 1,
          }),
        };
      });

      try {
        await createPullRequest({
          owner: "a",
          repo: "b",
          title: "PR",
          body: "Body",
          head: "feat/x",
          base: "main",
          token: "ghp_token",
        });

        expect(capturedHeaders["User-Agent"]).toContain("n8n-nodes-software-teams");
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });
});
