import { describe, test, expect } from "bun:test";
import { parseResearcherQuestions } from "../researcher-output";

describe("parseResearcherQuestions", () => {
  test("returns no questions when the `### Pre-plan questions` section says `_none._`", () => {
    const response = `
**The Research Agent** completed pre-plan discovery for issue #46.

### Codebase context

- Monorepo with apps/test-jedi.

### Pre-plan questions

_none._
`;
    const result = parseResearcherQuestions(response);
    expect(result.hasQuestions).toBe(false);
    expect(result.questions).toEqual([]);
  });

  test("accepts minor variants of `_none._` (with/without trailing dot)", () => {
    expect(parseResearcherQuestions("### Pre-plan questions\n\n_none_").hasQuestions).toBe(false);
    expect(parseResearcherQuestions("### Pre-plan questions\n\n_none._").hasQuestions).toBe(false);
    expect(parseResearcherQuestions("### Pre-plan questions\n\nnone").hasQuestions).toBe(false);
  });

  test("extracts bulleted questions from the section body", () => {
    const response = `
**The Research Agent** completed pre-plan discovery for issue #46.

### Codebase context

- Monorepo.

### Pre-plan questions

- Where should the Go backend live?
- Which port should the Go server listen on?
- What's the response shape?
`;
    const result = parseResearcherQuestions(response);
    expect(result.hasQuestions).toBe(true);
    expect(result.questions).toEqual([
      "Where should the Go backend live?",
      "Which port should the Go server listen on?",
      "What's the response shape?",
    ]);
  });

  test("accepts star bullets too", () => {
    const response = `
### Pre-plan questions

* Q1
* Q2
`;
    const result = parseResearcherQuestions(response);
    expect(result.questions).toEqual(["Q1", "Q2"]);
  });

  test("returns no questions when the section is missing entirely (conservative default)", () => {
    const response = `
**The Research Agent** completed pre-plan discovery.

### Codebase context

- Monorepo.
`;
    const result = parseResearcherQuestions(response);
    expect(result.hasQuestions).toBe(false);
    expect(result.questions).toEqual([]);
  });

  test("returns no questions for an empty response", () => {
    expect(parseResearcherQuestions("").hasQuestions).toBe(false);
    expect(parseResearcherQuestions("").questions).toEqual([]);
  });

  test("stops at the next `### ` heading", () => {
    const response = `
### Pre-plan questions

- Real Q1
- Real Q2

### Notes

- Don't read me as a question.
- Me neither.
`;
    const result = parseResearcherQuestions(response);
    expect(result.questions).toEqual(["Real Q1", "Real Q2"]);
  });

  test("ignores non-bullet prose between heading and bullets", () => {
    const response = `
### Pre-plan questions

A few things the issue doesn't pin down:

- Q1
- Q2
`;
    const result = parseResearcherQuestions(response);
    expect(result.questions).toEqual(["Q1", "Q2"]);
  });

  test("treats a section with prose but no bullets as no-questions (researcher misformatted)", () => {
    const response = `
### Pre-plan questions

Nothing comes to mind right now.
`;
    const result = parseResearcherQuestions(response);
    expect(result.hasQuestions).toBe(false);
  });

  test("trims whitespace from each question", () => {
    const response = `
### Pre-plan questions

-    Lots of leading space
-\ttabs followed by content
`;
    const result = parseResearcherQuestions(response);
    expect(result.questions).toEqual([
      "Lots of leading space",
      "tabs followed by content",
    ]);
  });

  test("`_none._` takes priority — bullets after it are ignored (researcher hedge)", () => {
    const response = `
### Pre-plan questions

_none._

- This bullet is just a placeholder example, not a real question.
`;
    const result = parseResearcherQuestions(response);
    expect(result.hasQuestions).toBe(false);
  });

  describe("opening summary + codebase context surfacing", () => {
    test("extracts the one-paragraph opening summary between the attribution line and the first heading", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #6186.

React monorepo with 4 portal apps; the error is in customer-portal where NoGuarantor.page.tsx calls useNavigation.

### Codebase context

- Root cause: dual-instance context problem.

### Pre-plan questions

- Should the shared page be kept?
`;
      const result = parseResearcherQuestions(response);
      expect(result.openingSummary).toBe(
        "React monorepo with 4 portal apps; the error is in customer-portal where NoGuarantor.page.tsx calls useNavigation.",
      );
    });

    test("extracts a multi-line opening summary verbatim until the first blank line", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #1.

Line one of the summary.
Line two continues it.

### Codebase context

- a
### Pre-plan questions
_none._
`;
      const result = parseResearcherQuestions(response);
      expect(result.openingSummary).toBe("Line one of the summary.\nLine two continues it.");
    });

    test("captures the codebase context body without the heading", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #6186.

summary.

### Codebase context

- Root cause identified: dual-instance context problem.
- The failing page is NoGuarantor.page.tsx at packages/nodifi-pages.

### Pre-plan questions

- Which fix should I apply?
`;
      const result = parseResearcherQuestions(response);
      expect(result.codebaseContext).toContain("Root cause identified");
      expect(result.codebaseContext).toContain("NoGuarantor.page.tsx");
      expect(result.codebaseContext).not.toContain("### Codebase context");
      // Stops at the next heading.
      expect(result.codebaseContext).not.toContain("Pre-plan questions");
      expect(result.codebaseContext).not.toContain("Which fix should I apply");
    });

    test("returns empty opening summary + empty context when sections are missing", () => {
      const response = `### Pre-plan questions

- Q1
`;
      const result = parseResearcherQuestions(response);
      expect(result.openingSummary).toBe("");
      expect(result.codebaseContext).toBe("");
      expect(result.questions).toEqual(["Q1"]);
    });

    test("surfaces context + opening summary even when there are no questions (no-op call site, but consistent shape)", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #2.

Everything is clear.

### Codebase context

- Existing patterns answer everything.

### Pre-plan questions

_none._
`;
      const result = parseResearcherQuestions(response);
      expect(result.hasQuestions).toBe(false);
      expect(result.openingSummary).toBe("Everything is clear.");
      expect(result.codebaseContext).toContain("Existing patterns answer everything.");
    });
  });

  describe("conversational answers section (`### Answers to your previous comment`)", () => {
    test("captures the answers body verbatim without the heading", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #6186.

Re-scoped to nodifi-portal per your correction.

### Answers to your previous comment

You were right that this is nodifi-portal, not customer-portal. My prior pass anchored on the App.tsx that mounted NavigationProvider with the most recent route additions — which happened to be customer-portal/src/App.tsx — without checking which app actually loads NoGuarantor.page.tsx at runtime. Re-checking via \`git log\` on nodifi-portal's route config: the route was added 2026-04-22 in commit a1b2c3d.

### Codebase context

- Re-scoped findings here.

### Pre-plan questions

- One more thing to confirm?
`;
      const result = parseResearcherQuestions(response);
      expect(result.previousCommentAnswers).toContain("You were right that this is nodifi-portal");
      expect(result.previousCommentAnswers).toContain("a1b2c3d");
      expect(result.previousCommentAnswers).not.toContain("### Answers to your previous comment");
      // Stops at next heading.
      expect(result.previousCommentAnswers).not.toContain("Re-scoped findings here.");
      expect(result.previousCommentAnswers).not.toContain("One more thing");
    });

    test("returns empty answers when the section is omitted (first-pass run)", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #1.

Summary.

### Codebase context

- Nothing yet.

### Pre-plan questions

- Q1
`;
      const result = parseResearcherQuestions(response);
      expect(result.previousCommentAnswers).toBe("");
    });

    test("captures answers alongside `_none._` for questions (researcher answered everything, no remaining questions)", () => {
      const response = `**The Research Agent** completed pre-plan discovery for issue #6186.

Re-scoped.

### Answers to your previous comment

This started failing after commit a1b2c3d (2026-04-22) added the route without a NavigationProvider wrapper. Only nodifi-portal is affected because the other portals don't import NoGuarantor.page.tsx.

### Codebase context

- Nothing else open.

### Pre-plan questions

_none._
`;
      const result = parseResearcherQuestions(response);
      expect(result.hasQuestions).toBe(false);
      expect(result.previousCommentAnswers).toContain("a1b2c3d");
      expect(result.previousCommentAnswers).toContain("Only nodifi-portal");
    });
  });
});
