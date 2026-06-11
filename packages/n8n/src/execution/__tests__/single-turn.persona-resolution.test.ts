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
const sourceSingleTurn = resolve(import.meta.dir, "..", "single-turn.ts");
const builtAgentsDir = resolve(pkgRoot, "dist", "agents");
const repoAgentsDir = resolve(repoRoot, ".claude", "agents");

const installedSingleTurnDir = resolve(pkgRoot, "dist", "src", "execution");

function candidatesFor(dirname: string, agentId: string): string[] {
  return [
    join(dirname, "..", "..", "agents", `${agentId}.md`),
    join(dirname, "..", "..", "..", "..", "..", ".claude", "agents", `${agentId}.md`),
    join(dirname, "..", "..", "..", "..", "..", "agents", `${agentId}.md`),
  ];
}

function resolveFor(dirname: string, agentId: string): string | null {
  return candidatesFor(dirname, agentId).find(existsSync) ?? null;
}

describe("resolveAgentSpecPath — bundled specs ship + both-layout resolution (AC7, AC8)", () => {
  describe("AC7: specialist personas ship inside dist after the build", () => {
    test("dist/agents holds the 33 bundled specialist specs", () => {
      expect(existsSync(builtAgentsDir)).toBeTrue();
      const repoSpecs = repoSpecNames();
      expect(repoSpecs.length).toBe(33);
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
    test("single-turn.ts pins the three __dirname-relative candidates this test models", () => {
      const source = readFileSync(sourceSingleTurn, "utf8");
      expect(source).toContain('join(__dirname, "..", "..", "agents", `${agentId}.md`)');
      expect(source).toContain(
        'join(__dirname, "..", "..", "..", "..", "..", ".claude", "agents", `${agentId}.md`)',
      );
      expect(source).toContain(
        'join(__dirname, "..", "..", "..", "..", "..", "agents", `${agentId}.md`)',
      );
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
      const [installedCandidate] = candidatesFor(
        installedSingleTurnDir,
        "software-teams-backend",
      );
      expect(installedCandidate).toBe(join(builtAgentsDir, "software-teams-backend.md"));
      expect(installedCandidate).not.toContain(`${repoRoot}/packages/n8n/agents`);
    });
  });

  describe("AC8: DEV layout — candidate 2 resolves repo-root .claude/agents (climb-5)", () => {
    const sandbox = { root: "" };

    beforeEach(() => {
      sandbox.root = mkdtempSync(join(tmpdir(), "st-dev-layout-"));
    });

    afterEach(() => {
      rmSync(sandbox.root, { recursive: true, force: true });
    });

    function buildDevTree(agentId: string, body: string): string {
      const execDir = join(sandbox.root, "packages", "n8n", "dist", "src", "execution");
      mkdirSync(execDir, { recursive: true });
      const claudeAgents = join(sandbox.root, ".claude", "agents");
      mkdirSync(claudeAgents, { recursive: true });
      writeFileSync(join(claudeAgents, `${agentId}.md`), body, "utf8");
      return execDir;
    }

    test("climb-5 from dist/src/execution reaches synthetic repo-root .claude/agents", () => {
      const execDir = buildDevTree("software-teams-backend", "DEV BACKEND PERSONA");
      const resolved = resolveFor(execDir, "software-teams-backend");
      expect(resolved).toBe(
        join(sandbox.root, ".claude", "agents", "software-teams-backend.md"),
      );
    });

    test("candidate 2 wins when no installed dist/agents sibling exists (climb-5 != climb-4)", () => {
      const execDir = buildDevTree("software-teams-frontend", "DEV FRONTEND PERSONA");
      const [installed, devClaude] = candidatesFor(execDir, "software-teams-frontend");
      expect(existsSync(installed)).toBeFalse();
      const resolved = resolveFor(execDir, "software-teams-frontend");
      expect(resolved).toBe(devClaude);
    });

    test("the dev resolution does NOT land in packages/ (the old climb-4 off-by-one)", () => {
      const execDir = buildDevTree("software-teams-quality", "DEV QUALITY PERSONA");
      const resolved = resolveFor(execDir, "software-teams-quality");
      expect(resolved).not.toContain(`${join(sandbox.root, "packages")}`);
      expect(resolved).toContain(join(sandbox.root, ".claude", "agents"));
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
