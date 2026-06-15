/**
 * Make the published community node self-contained.
 *
 * n8n's community-node rules forbid runtime `dependencies` and any
 * `peerDependencies` other than `n8n-workflow`/`ai-node-sdk`
 * (`@n8n/community-nodes/no-runtime-dependencies` + `valid-peer-dependencies`).
 * The nodes import `@websitelabs/software-teams` at runtime (value imports:
 * buildCorrelationTag, parseCorrelationTag, slugify, the single-turn API, …),
 * but `n8n-node build` (tsc, ADR-003) leaves a bare `require("@websitelabs/
 * software-teams")` in the output — which would not resolve once installed.
 *
 * This post-build pass inlines the shared lib into every built `.js` that
 * requires it, so the package ships with ZERO third-party runtime deps while
 * keeping ONE source of truth (ADR-001 — the lib stays imported in source).
 *
 * Critical invariants:
 *  - Bundle IN PLACE (overwrite each file at its own path) so `__dirname`-based
 *    persona-spec resolution in single-turn.js (ADR-004) is unchanged.
 *  - Keep the n8n package's OWN relative imports (`../../src/...`) EXTERNAL —
 *    they ship in `dist/src/` and resolve at runtime. Only the shared lib's
 *    OWN internal relative imports get bundled.
 *  - Keep `n8n-workflow` and node builtins external.
 */
const esbuild = require("esbuild");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const distDir = join(__dirname, "..", "dist");
const SHARED = "@websitelabs/software-teams";

function walkJs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const targets = walkJs(distDir).filter((file) => {
  const src = readFileSync(file, "utf8");
  return src.includes(`require("${SHARED}")`) || src.includes(`require('${SHARED}')`);
});

if (targets.length === 0) {
  console.log(`bundle-shared-lib: no built file requires ${SHARED} — nothing to inline.`);
  process.exit(0);
}

/** Externalise n8n-workflow, node builtins, and the n8n package's own
 *  dist-relative imports; bundle everything else (the shared lib + its
 *  transitive bare deps such as consola, and the lib's internal relatives). */
const externalisePlugin = {
  name: "externalise-host-and-own-dist",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (args.path === "n8n-workflow" || args.path.startsWith("node:")) {
        return { path: args.path, external: true };
      }
      if (args.path.startsWith(".")) {
        // Relative import from inside THIS package's dist tree → keep external
        // (resolves to a shipped dist/ file). Relative import from inside the
        // shared lib (node_modules) → bundle it.
        if (args.importer.startsWith(distDir)) {
          return { path: args.path, external: true };
        }
        return null;
      }
      return null; // bare specifier (shared lib, consola, …) → bundle
    });
  },
};

esbuild
  .build({
    entryPoints: targets,
    outdir: distDir,
    outbase: distDir,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    allowOverwrite: true,
    logLevel: "warning",
    plugins: [externalisePlugin],
  })
  .then(() => {
    console.log(`bundle-shared-lib: inlined ${SHARED} into ${targets.length} built file(s).`);
  })
  .catch((err) => {
    console.error("bundle-shared-lib: FAILED");
    console.error(err);
    process.exit(1);
  });
