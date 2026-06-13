import { describe, test, expect } from "bun:test";
import { updateGitignore, buildManagedBlock, ST_GITIGNORE_PATHS } from "../gitignore";

describe("updateGitignore", () => {
  test("appends the managed block to empty content", () => {
    const out = updateGitignore("");
    expect(out).toContain(".software-teams/");
    expect(out).toContain(".claude/hooks/");
    expect(out).toContain(".claude/agents/software-teams-*.md");
    expect(out).toContain(".claude/statusline/");
    expect(out).toContain(".claude/settings.json");
    expect(out.endsWith("\n")).toBe(true);
  });

  test("covers every artefact init generates", () => {
    const out = updateGitignore("");
    for (const p of ST_GITIGNORE_PATHS) expect(out).toContain(p);
  });

  test("preserves existing user content", () => {
    const existing = "node_modules/\ndist/\n.env\n";
    const out = updateGitignore(existing);
    expect(out).toContain("node_modules/");
    expect(out).toContain("dist/");
    expect(out).toContain(".env");
    expect(out).toContain(".software-teams/");
  });

  test("is idempotent — running on its own output is a no-op", () => {
    const once = updateGitignore("node_modules/\n");
    const twice = updateGitignore(once);
    expect(twice).toBe(once);
  });

  test("does not duplicate the block on re-run", () => {
    const once = updateGitignore("");
    const twice = updateGitignore(once);
    const occurrences = twice.split(".claude/hooks/").length - 1;
    expect(occurrences).toBe(1);
  });

  test("migrates a legacy single-marker block to the managed block (no duplication)", () => {
    const legacy = [
      "node_modules/",
      "",
      "# Software Teams framework — remove these lines to version control Software Teams artefacts",
      ".software-teams/",
      ".claude/commands/st/",
      "",
    ].join("\n");
    const out = updateGitignore(legacy);
    // legacy marker gone, user content kept, new artefacts added, no dup of .software-teams/
    expect(out).not.toContain("# Software Teams framework —");
    expect(out).toContain("node_modules/");
    expect(out).toContain(".claude/hooks/");
    expect((out.match(/^\.software-teams\/$/gm) ?? []).length).toBe(1);
  });

  test("buildManagedBlock is sentinel-wrapped", () => {
    const block = buildManagedBlock();
    expect(block.startsWith("# >>> Software Teams")).toBe(true);
    expect(block.trimEnd().endsWith("# <<< Software Teams <<<")).toBe(true);
  });
});
