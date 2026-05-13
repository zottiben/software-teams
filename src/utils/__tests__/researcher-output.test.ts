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
});
