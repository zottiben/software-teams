import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "child_process";
import path from "node:path";

describe("Grep Audit: Zero straggler `jdi`/`JDI` matches outside allowlist", () => {
  it("should not contain unexpected `jdi` or `JDI` strings outside the allowlist", () => {
    // Read the allowlist file
    const allowlistPath = path.join(process.cwd(), "scripts", "grep-audit-allowlist.txt");
    if (!existsSync(allowlistPath)) {
      throw new Error(
        `Allowlist file not found at ${allowlistPath}. Expected: scripts/grep-audit-allowlist.txt`
      );
    }

    const allowlistContent = readFileSync(allowlistPath, "utf-8");
    const allowlistLines = allowlistContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    // Compile allowlist patterns — treat each line as a regex pattern
    const allowlistPatterns = allowlistLines.map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch (e) {
        // If it fails to compile as regex, treat it as a literal string
        // and escape it for use in a regex
        return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
    });

    // Get all tracked files
    const filesOutput = execSync("git ls-files", { encoding: "utf-8" });
    const allFiles = filesOutput
      .split("\n")
      .filter((f) => f.trim())
      .filter((f) => !f.startsWith(".software-teams/plans/1-01-"))
      // The audit test itself searches for "jdi" — its own source contains
      // those literals as identifiers, comments, and assertion strings.
      .filter((f) => f !== "src/__tests__/grep-audit.test.ts")
      // The allowlist literally contains "jdi" patterns by design.
      .filter((f) => f !== "scripts/grep-audit-allowlist.txt")
      // Vendor lockfile — historical package name from before the rebrand.
      .filter((f) => f !== "bun.lock" && f !== "package-lock.json");

    const failedMatches: string[] = [];

    const BINARY_EXT = new Set([
      ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".tar",
      ".tgz", ".jar", ".class", ".so", ".dylib", ".dll", ".exe", ".bin",
      ".woff", ".woff2", ".ttf", ".otf", ".webp", ".mp3", ".mp4", ".wav",
    ]);
    for (const file of allFiles) {
      const dotIdx = file.lastIndexOf(".");
      if (dotIdx >= 0 && BINARY_EXT.has(file.slice(dotIdx).toLowerCase())) {
        continue;
      }

      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          // Case-insensitive search for 'jdi'
          if (!line.toLowerCase().includes("jdi")) {
            continue;
          }

          // Check if this line matches any allowlist pattern
          let isAllowed = false;
          for (const pattern of allowlistPatterns) {
            if (pattern.test(line)) {
              isAllowed = true;
              break;
            }
          }

          if (!isAllowed) {
            // Extract the matched substring for clarity
            const matchIndex = line.toLowerCase().indexOf("jdi");
            const substring = line.substring(Math.max(0, matchIndex - 20), matchIndex + 30);
            failedMatches.push(`${file}:${lineNum + 1}: ${substring.trim()}`);
          }
        }
      } catch {
        // Skip files that can't be read (binaries, etc.)
        continue;
      }
    }

    if (failedMatches.length > 0) {
      console.error(
        "Found unexpected `jdi`/`JDI` matches outside the allowlist:\n" +
          failedMatches.join("\n") +
          "\n\nEither:\n" +
          "1. Fix the underlying file (rebrand miss)\n" +
          "2. Add a justified allowlist entry in scripts/grep-audit-allowlist.txt",
      );
    }

    expect(failedMatches).toEqual([]);
  });

  it("should have a valid allowlist file with justification comments", () => {
    const allowlistPath = path.join(process.cwd(), "scripts", "grep-audit-allowlist.txt");
    expect(existsSync(allowlistPath)).toBe(true);

    const content = readFileSync(allowlistPath, "utf-8");
    const lines = content.split("\n");

    // Each non-comment, non-empty line should have a preceding comment justifying it
    let lastCommentIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("#")) {
        lastCommentIndex = i;
      } else if (line && !line.startsWith("#")) {
        const hasPrecedingComment = lastCommentIndex >= 0 && lastCommentIndex < i;
        if (!hasPrecedingComment) {
          throw new Error(
            `Allowlist entry at line ${i + 1} ("${line}") has no preceding justification comment`,
          );
        }
      }
    }
  });
});
