import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const pkgRoot = resolve(import.meta.dir, "..", "..", "..");
const repoAgentsDir = resolve(pkgRoot, "..", "cli", "agents");

const NODE_BASENAMES = [
  "SoftwareTeamsAgent",
  "SoftwareTeamsTrigger",
  "SoftwareTeamsOutput",
  "SoftwareTeamsOrchestrator",
  "SoftwareTeamsSlackHitl",
  "SoftwareTeamsWorkspace",
  "SoftwareTeamsFinaliser",
  "SoftwareTeamsPrFeedback",
  "SoftwareTeamsHitl",
  "SoftwareTeamsCleanup",
];

const tarState = { files: [] as string[], packDir: "" };

function packAndList(): string[] {
  tarState.packDir = mkdtempSync(join(tmpdir(), "st-npm-pack-"));
  execFileSync("npm", ["pack", "--pack-destination", tarState.packDir], {
    cwd: pkgRoot,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const tarball = readdirSync(tarState.packDir).find((name) => name.endsWith(".tgz"));
  expect(tarball).toBeDefined();
  const listing = execFileSync("tar", ["-tzf", join(tarState.packDir, tarball!)], {
    encoding: "utf8",
  });
  return listing
    .split("\n")
    .map((line) => line.replace(/^package\//, "").trim())
    .filter(Boolean);
}

function repoSpecNames(): string[] {
  return readdirSync(repoAgentsDir).filter(
    (name) => name.startsWith("software-teams-") && name.endsWith(".md"),
  );
}

describe("npm pack — publish-ready tarball contents (AC7, AC10)", () => {
  beforeAll(() => {
    tarState.files = packAndList();
  }, 300_000);

  afterAll(() => {
    if (tarState.packDir) rmSync(tarState.packDir, { recursive: true, force: true });
  });

  describe("declared packaging config (AC10)", () => {
    test("package.json declares a files allowlist and publishConfig", () => {
      const manifest = JSON.parse(
        readFileSync(join(pkgRoot, "package.json"), "utf8"),
      ) as { files?: string[]; publishConfig?: { access?: string } };
      expect(Array.isArray(manifest.files)).toBeTrue();
      expect(manifest.files).toContain("dist");
      expect(manifest.publishConfig).toBeDefined();
      expect(manifest.publishConfig?.access).toBe("public");
    });
  });

  describe("tarball CONTAINS dist nodes + credential (AC10)", () => {
    test("all ten built node bundles are packed", () => {
      for (const base of NODE_BASENAMES) {
        const expected = `dist/nodes/${base}/${base}.node.js`;
        expect(tarState.files).toContain(expected);
      }
    });

    test("exactly ten *.node.js entries ship (no more, no fewer)", () => {
      const nodeJs = tarState.files.filter((p) => p.endsWith(".node.js"));
      expect(nodeJs.length).toBe(10);
    });

    test("the credential entry-point is packed", () => {
      expect(tarState.files).toContain(
        "dist/credentials/SoftwareTeamsApi.credentials.js",
      );
    });
  });

  describe("tarball CONTAINS the 33 bundled specialist specs (AC7)", () => {
    test("every repo software-teams-* spec ships under dist/agents", () => {
      const specs = repoSpecNames();
      expect(specs.length).toBe(33);
      for (const spec of specs) {
        expect(tarState.files).toContain(`dist/agents/${spec}`);
      }
    });

    test("exactly 33 dist/agents/*.md specs are packed", () => {
      const packedSpecs = tarState.files.filter(
        (p) => p.startsWith("dist/agents/") && p.endsWith(".md"),
      );
      expect(packedSpecs.length).toBe(33);
    });
  });

  describe("tarball EXCLUDES source / test / dev cruft (AC10, R-29)", () => {
    test("no top-level TypeScript source (nodes/ or src/) is packed", () => {
      const srcTs = tarState.files.filter(
        (p) =>
          p.endsWith(".ts") &&
          !p.endsWith(".d.ts") &&
          (p.startsWith("nodes/") || p.startsWith("src/")),
      );
      expect(srcTs).toEqual([]);
    });

    test("no __tests__ directories are packed", () => {
      const tests = tarState.files.filter((p) => p.includes("__tests__"));
      expect(tests).toEqual([]);
    });

    test("no examples/ or scripts/ dev dirs are packed", () => {
      const dev = tarState.files.filter(
        (p) => p.startsWith("examples/") || p.startsWith("scripts/"),
      );
      expect(dev).toEqual([]);
    });

    test("no tsconfig / eslint dev config is packed", () => {
      const config = tarState.files.filter(
        (p) => p.startsWith("tsconfig") || p.includes("eslint"),
      );
      expect(config).toEqual([]);
    });
  });

  describe("declaration files are expected and fine (AC10 note)", () => {
    test("dist *.d.ts declaration files are present (a feature, not cruft)", () => {
      const decls = tarState.files.filter(
        (p) => p.startsWith("dist/") && p.endsWith(".d.ts"),
      );
      expect(decls.length).toBeGreaterThan(0);
    });
  });
});
