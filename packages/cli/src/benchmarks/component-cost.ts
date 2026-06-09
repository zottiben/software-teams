/**
 * Baseline benchmark for the component-tag mechanism.
 *
 * Records, for representative spawn scenarios, what the model actually pays
 * after the pivot — i.e. cost with every @ST: tag inlined at sync time.
 * Output is appended to `.software-teams/persistence/component-bench.jsonl`
 * so successive runs can be diffed.
 *
 * Mode:
 *   --from-resolved  (default) Read inlined output from `.claude/agents/` and
 *                    `.claude/commands/st/` — measures cost post-sync, where
 *                    every @ST: tag is already baked into the host file.
 *
 * The legacy `--from-source` mode (read source markdown + resolve tags) was
 * retired alongside `framework/components/**\/*.md` in plan 3-02. Source
 * resolution is now meaningless because there is no markdown layer to scan.
 *
 * Run via:
 *   bun run src/benchmarks/component-cost.ts                  (from-resolved)
 *   bun run src/benchmarks/component-cost.ts --from-resolved  (explicit)
 */

import { main } from "./component-cost/output";

// --- CLI flag parsing ---
const args = process.argv.slice(2);
if (args.includes("--from-source")) {
  console.error(
    "--from-source mode was retired in plan 3-02 (markdown component layer deleted).\n" +
      "Run without flags or with --from-resolved to measure the inlined output in .claude/agents/.",
  );
  process.exit(1);
}

main();
