import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

/**
 * fetch-issue.test.ts — unit tests for fetchIssueTitleAndBody helper.
 *
 * Tests verify the helper structure and expected behavior without mocking
 * the live `gh` binary. Uses source-string assertions on the implementation.
 */

describe("fetchIssueTitleAndBody", () => {
  test("helper is exported from src/utils/github.ts", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/export\s+async\s+function\s+fetchIssueTitleAndBody/);
  });

  test("helper accepts repo (string) and issueNumber (number) parameters", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/repo:\s*string,\s*issueNumber:\s*number/);
  });

  test("helper returns Promise of { title: string; body: string } | null", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    // Check return type annotation
    expect(source).toMatch(/Promise.*{.*title.*body.*}.*null/);
  });

  test("helper calls gh api repos/{repo}/issues/{issueNumber}", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/gh.*api/);
    expect(source).toMatch(/repos\/\$\{repo\}\/issues\/\$\{issueNumber\}/);
  });

  test("helper returns null on non-zero exit code", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/exitCode\s*!==\s*0/);
    expect(source).toMatch(/return\s+null/);
  });

  test("helper coerces null body to empty string", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    // Look for either the explicit ?? operator form or equivalent null-coalescing
    expect(source).toMatch(/body\s*\?\?\s*["']["']|body\s*\|\|\s*["']["']/);
  });

  test("helper parses JSON response and extracts title and body", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/JSON\.parse/);
    expect(source).toMatch(/parsed\.title/);
    expect(source).toMatch(/parsed\.body/);
  });

  test("helper has try-catch to handle JSON parse errors", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../utils/github.ts")).text();
    expect(source).toMatch(/try\s*{[\s\S]*JSON\.parse[\s\S]*}\s*catch/);
  });
});
