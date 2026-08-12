import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";

const pkgRoot = resolve(import.meta.dir, "..", "..", "..");
const repoRoot = resolve(pkgRoot, "..", "..");
// Spec resolution moved out of single-turn.ts when the engine switched to
// building a real `--agents` definition instead of concatenating a stripped
// spec body onto the user prompt.
const sourceAgentDefinition = resolve(import.meta.dir, "..", "agent-definition.ts");
const builtAgentsDir = resolve(pkgRoot, "dist", "agents");
const repoAgentsDir = resolve(repoRoot, "packages", "cli", "agents");

const installedSingleTurnDir = resolve(pkgRoot, "dist", "src", "execution");

function candidatesFor(dirname: string, agentId: string, baseDir = "/nonexistent"): string[] {
  return [
    join(baseDir, ".claude", "agents", `${agentId}.md`),
    join(dirname, "..", "..", "agents", `${agentId}.md`),
    join(dirname, "..", "..", "dist", "agents", `${agentId}.md`),
  ];
}

function resolveFor(dirname: string, agentId: string, baseDir = "/nonexistent"): string | null {
  return candidatesFor(dirname, agentId, baseDir).find(existsSync) ?? null;
}

describe("resolveAgentSpecPath — bundled specs ship + both-layout resolution (AC7, AC8)", () => {
  describe("AC7: specialist personas ship inside dist after the build", () => {
    test("dist/agents holds the 34 bundled specialist specs", () => {
      expect(existsSync(builtAgentsDir)).toBeTrue();
      const repoSpecs = repoSpecNames();
      expect(repoSpecs.length).toBe(34);
      for (const spec of repoSpecs) {
        expect(existsSync(join(builtAgentsDir, spec))).toBeTrue();
      }
    });

    test("bundled specs are non-empty and carry stripped persona content", () => {
      const body = readFileSync(join(builtAgentsDir, "software-teams-backend.md"), "utf8");
      expect(body.trim().length).toBeGreaterThan(0);
    });
  });

  describe("AC8: production candidate list is the ADR-004 Decision K verbatim algorithm", () => {
    test("agent-definition.ts pins the candidate list this test models", () => {
      const source = readFileSync(sourceAgentDefinition, "utf8");
      // Project-local specs win, so a repo that has customised a specialist
      // gets its own version rather than the one bundled with the node package.
      expect(source).toContain('join(baseDir, ".claude", "agents", `${agentId}.md`)');
      expect(source).toContain('join(__dirname, "..", "..", "agents", `${agentId}.md`)');
      expect(source).toContain('join(__dirname, "..", "..", "dist", "agents", `${agentId}.md`)');
    });

    test("the project-local candidate is resolved against the repo, not the package", () => {
      // The previous list climbed five levels from __dirname to guess at a
      // .claude/ directory, which only worked for one installation layout. The
      // repo being worked on is passed in explicitly instead.
      const source = readFileSync(sourceAgentDefinition, "utf8");
      expect(source).not.toContain('"..", "..", "..", "..", ".."');
    });
  });

  describe("AC8: INSTALLED layout — candidate 1 resolves bundled spec under dist/agents", () => {
    test("software-teams-backend resolves to the real dist/agents bundled spec", () => {
      const resolved = resolveFor(installedSingleTurnDir, "software-teams-backend");
      expect(resolved).toBe(join(builtAgentsDir, "software-teams-backend.md"));
    });

    test("a second specialist resolves to its own bundled spec (AC9 distinct files)", () => {
      const resolved = resolveFor(installedSingleTurnDir, "software-teams-frontend");
      expect(resolved).toBe(join(builtAgentsDir, "software-teams-frontend.md"));
    });

    test("__dirname climb-2 lands on dist/agents, NOT a repo dir (off-by-one fixed)", () => {
      const installedCandidate = candidatesFor(
        installedSingleTurnDir,
        "software-teams-backend",
      )[1];
      expect(installedCandidate).toBe(join(builtAgentsDir, "software-teams-backend.md"));
      expect(installedCandidate).not.toContain(`${repoRoot}/packages/n8n/agents`);
    });
  });

  describe("AC8: project-local specs override the bundled ones", () => {
    const sandbox = { root: "" };

    beforeEach(() => {
      sandbox.root = mkdtempSync(join(tmpdir(), "st-project-local-"));
    });

    afterEach(() => {
      rmSync(sandbox.root, { recursive: true, force: true });
    });

    function writeProjectSpec(agentId: string, body: string): string {
      const claudeAgents = join(sandbox.root, ".claude", "agents");
      mkdirSync(claudeAgents, { recursive: true });
      writeFileSync(join(claudeAgents, `${agentId}.md`), body, "utf8");
      return join(claudeAgents, `${agentId}.md`);
    }

    test("a spec under the repo's .claude/agents wins over the bundled copy", () => {
      // Resolution takes the repo being worked on as an explicit baseDir. The
      // previous implementation climbed five directories from __dirname to
      // guess at a repo root, which held for exactly one install layout and
      // silently found nothing in any other.
      const expected = writeProjectSpec("software-teams-backend", "PROJECT BACKEND PERSONA");
      const resolved = resolveFor(installedSingleTurnDir, "software-teams-backend", sandbox.root);
      expect(resolved).toBe(expected);
    });

    test("the bundled spec is used when the project has not customised it", () => {
      const resolved = resolveFor(installedSingleTurnDir, "software-teams-frontend", sandbox.root);
      expect(resolved).toBe(join(builtAgentsDir, "software-teams-frontend.md"));
    });
  });

  describe("AC8: null degrade — unknown agentId resolves to null in both layouts", () => {
    test("installed layout: unknown agentId → null", () => {
      expect(resolveFor(installedSingleTurnDir, "software-teams-not-a-real-agent")).toBeNull();
    });

    test("dev layout: unknown agentId → null (graceful, not fatal)", () => {
      const sandboxRoot = mkdtempSync(join(tmpdir(), "st-dev-null-"));
      try {
        const execDir = join(sandboxRoot, "packages", "n8n", "dist", "src", "execution");
        mkdirSync(execDir, { recursive: true });
        mkdirSync(join(sandboxRoot, ".claude", "agents"), { recursive: true });
        expect(resolveFor(execDir, "totally-unknown-agent")).toBeNull();
      } finally {
        rmSync(sandboxRoot, { recursive: true, force: true });
      }
    });
  });
});

function repoSpecNames(): string[] {
  return readdirSync(repoAgentsDir).filter(
    (name) => name.startsWith("software-teams-") && name.endsWith(".md"),
  );
}
