import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SPECIALIST,
  SPECIALISTS,
  SPECIALIST_OPTIONS,
  defaultPromptFor,
} from "../specialists";

const AGENTS_DIR = join(import.meta.dir, "../../../../cli/agents");

/** The catalogue the n8n canvas offers, deliberately narrower than agents/. */
const EXPECTED = [
  "software-teams-backend",
  "software-teams-codebase-mapper",
  "software-teams-feedback-learner",
  "software-teams-frontend",
  "software-teams-planner",
  "software-teams-pr-feedback",
  "software-teams-pr-generator",
  "software-teams-programmer",
  "software-teams-qa-tester",
  "software-teams-researcher",
  "software-teams-support-triage",
  "software-teams-verifier",
];

describe("specialist catalogue", () => {
  test("offers exactly the agreed twelve", () => {
    expect([...SPECIALIST_OPTIONS].map((o) => o.value).sort()).toEqual([...EXPECTED].sort());
  });

  test("every offered agent has a spec on disk", () => {
    // The failure this catches is a cull that removes a spec but leaves the
    // dropdown entry, which only surfaces as a failed run.
    for (const { value } of SPECIALIST_OPTIONS) {
      expect(existsSync(join(AGENTS_DIR, `${value}.md`))).toBe(true);
    }
  });

  test("the default selection is one of the offered agents", () => {
    expect([...SPECIALIST_OPTIONS].map((o) => o.value)).toContain(DEFAULT_SPECIALIST);
  });

  test("options are a name/value projection of the catalogue", () => {
    expect(SPECIALIST_OPTIONS).toHaveLength(SPECIALISTS.length);
    for (const [i, option] of SPECIALIST_OPTIONS.entries()) {
      expect(option.name).toBe(SPECIALISTS[i]!.name);
      expect(option.value).toBe(SPECIALISTS[i]!.value);
    }
  });
});

describe("prefilled prompts", () => {
  test("every default is an n8n expression", () => {
    // Without the leading `=` the braces are inert text and the agent receives
    // them literally, which looks fine in the editor and fails at run time.
    for (const specialist of SPECIALISTS) {
      expect(specialist.defaultPrompt.startsWith("=")).toBe(true);
    }
  });

  test("every default still carries the upstream task through", () => {
    for (const specialist of SPECIALISTS) {
      expect(specialist.defaultPrompt).toContain("{{ $json.input.prompt }}");
    }
  });

  test("every default adds instruction of its own", () => {
    for (const specialist of SPECIALISTS) {
      const instruction = specialist.defaultPrompt
        .replace("{{ $json.input.prompt }}", "")
        .replace(/^=/, "")
        .trim();
      expect(instruction.length).toBeGreaterThan(40);
    }
  });

  test("defaults differ per agent", () => {
    const prompts = new Set(SPECIALISTS.map((s) => s.defaultPrompt));
    expect(prompts.size).toBe(SPECIALISTS.length);
  });

  test("defaultPromptFor resolves a known agent", () => {
    expect(defaultPromptFor("software-teams-support-triage")).toContain("Triage the support ticket");
  });

  test("defaultPromptFor falls back to the bare upstream task", () => {
    expect(defaultPromptFor("software-teams-nope")).toBe("={{ $json.input.prompt }}");
  });
});
