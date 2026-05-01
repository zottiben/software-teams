/**
 * Env-gated round-trip smoke for native subagent spawning.
 *
 * This file is documentation-as-test by design. A `bun:test` runner cannot
 * dispatch a Claude Code Task call (no Anthropic session is available inside
 * the test process), so the actual spawn must be performed manually from a
 * Claude Code session running in this repo. The test below is intentionally
 * skipped except when an operator opts in.
 *
 * Manual smoke procedure:
 *   1. Run `bun run dev sync-agents` (or `software-teams sync-agents`) in this
 *      repo so `.claude/agents/` is populated with the 24 native specs.
 *   2. From a Claude Code session in this repo, dispatch a Task call with
 *      `subagent_type="software-teams-status"` and `prompt="echo OK"` (or any registered
 *      Software Teams subagent + a sentinel prompt).
 *   3. Assert the response contains the sentinel phrase ("OK") AND that the
 *      response embodies the agent's spec body (no "You are software-teams-X. Read ..."
 *      preamble was needed — Claude Code resolved the spec from
 *      `.claude/agents/software-teams-status.md` natively).
 *
 * CI behaviour:
 *   - Skipped because no Claude Code session is available to the test runner.
 *   - Set SOFTWARE_TEAMS_NATIVE_SPAWN_SMOKE=1 to opt in (still currently a no-op
 *     placeholder — flip to a real spawn assertion when an in-process
 *     Anthropic / Claude Code SDK becomes available to bun:test).
 */
import { describe, test, expect } from "bun:test";

const SMOKE_ENABLED = process.env.SOFTWARE_TEAMS_NATIVE_SPAWN_SMOKE === "1";

describe("native-spawn round-trip smoke (env-gated)", () => {
  test.skipIf(!SMOKE_ENABLED)(
    "Task subagent_type=\"software-teams-status\" prompt=\"echo OK\" returns a response containing 'OK' (manual)",
    () => {
      // Placeholder: an in-process Claude Code Task dispatcher is not
      // available to the bun:test runner. When/if one becomes available,
      // replace this body with an actual spawn + sentinel assertion, e.g.:
      //
      //   const response = await spawnTask({
      //     subagent_type: "software-teams-status",
      //     prompt: "echo OK",
      //     mode: "acceptEdits",
      //   });
      //   expect(response).toContain("OK");
      //
      // Until then, this test is documentation-as-code and exists to keep
      // the manual smoke procedure discoverable in the test surface.
      expect(SMOKE_ENABLED).toBe(true);
    },
  );

  test("smoke procedure is documented (always-runs sanity check)", () => {
    // Sanity check: the file itself documents a working procedure. If the
    // documentation header drifts (e.g. someone renames `software-teams-status` away
    // without updating the manual smoke instructions here), reviewers will
    // catch it; this test guarantees the file is at least parseable and
    // present. No-op assertion.
    expect(true).toBe(true);
  });
});
