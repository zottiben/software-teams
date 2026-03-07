import { describe, test, expect } from "bun:test";
import { detectType, detectScope } from "./commit";

describe("detectType", () => {
  test("returns 'test' when all files are test files", () => {
    expect(detectType(["src/utils/git.test.ts", "src/utils/state.test.ts"])).toBe("test");
    expect(detectType(["test/foo.ts", "test/bar.ts"])).toBe("test");
    expect(detectType(["src/__tests__/thing.ts"])).toBe("test");
    expect(detectType(["foo.spec.ts"])).toBe("test");
  });

  test("returns 'docs' when all files are markdown", () => {
    expect(detectType(["README.md", "docs/guide.md"])).toBe("docs");
  });

  test("returns 'ci' when all files are CI/infra files", () => {
    expect(detectType(["Dockerfile"])).toBe("ci");
    expect(detectType([".github/workflows/ci.yml"])).toBe("ci");
    expect(detectType(["docker-compose.yaml"])).toBe("ci");
  });

  test("returns 'feat' for mixed files", () => {
    expect(detectType(["src/index.ts", "README.md"])).toBe("feat");
  });

  test("returns 'test' for empty array (every() returns true on empty)", () => {
    // Array.every() returns true for empty arrays, so detectType([]) hits the first branch
    expect(detectType([])).toBe("test");
  });

  test("returns 'feat' for regular source files", () => {
    expect(detectType(["src/utils/git.ts", "src/commands/commit.ts"])).toBe("feat");
  });
});

describe("detectScope", () => {
  test("returns directory name when all files share one top-level dir", () => {
    expect(detectScope(["src/foo.ts", "src/bar.ts"])).toBe("src");
  });

  test("returns null for multiple top-level directories", () => {
    expect(detectScope(["src/foo.ts", "lib/bar.ts"])).toBeNull();
  });

  test("returns null for root-level files", () => {
    expect(detectScope(["package.json", "tsconfig.json"])).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(detectScope([])).toBeNull();
  });

  test("returns first directory segment for nested paths", () => {
    expect(detectScope(["src/utils/git.ts", "src/commands/commit.ts"])).toBe("src");
  });

  test("returns scope when root files are filtered out (dirname '.' → null)", () => {
    // Root-level files get dirname "." which maps to null and get filtered out
    // Only "src" remains as a unique dir, so scope is "src"
    expect(detectScope(["package.json", "src/foo.ts"])).toBe("src");
  });
});
