/**
 * Parser for the pre-plan researcher's structured response.
 *
 * The Research Agent's response shape (mandated by
 * `buildPrePlanDiscoveryBrief` in `router-prompts.ts`) is:
 *
 *   **The Research Agent** completed pre-plan discovery for issue #N.
 *
 *   [one-sentence summary]
 *
 *   ### Codebase context
 *
 *   - observation 1
 *   - observation 2
 *
 *   ### Pre-plan questions
 *
 *   - question 1   (or `_none._` when nothing remains open)
 *
 * The action runner uses this parser to decide whether the planning run
 * can proceed (no questions) or must abort and surface the questions
 * comment to the user (Phase C headless ambiguity gate). The
 * `codebaseContext` + `openingSummary` fields are surfaced to the user
 * alongside the questions so they can see HOW the researcher reasoned —
 * otherwise a wrong question is opaque, with no anchor for the user to
 * push back on.
 *
 * When the response is malformed or sections are missing, the parser
 * conservatively returns whatever it could extract — better to let the
 * planner run with partial findings than block on a parse error.
 */

export interface PrePlanQuestions {
  hasQuestions: boolean;
  questions: string[];
  /**
   * The one-paragraph summary the researcher emits between the
   * `**The Research Agent** completed…` opener and the first `###`
   * heading. Empty when the response doesn't carry one.
   */
  openingSummary: string;
  /**
   * Raw markdown body of the `### Codebase context` section (bullets +
   * any inline commentary), without the heading line. Empty when the
   * section is missing.
   */
  codebaseContext: string;
  /**
   * Raw markdown body of the `### Answers to your previous comment`
   * section — the researcher's direct responses to questions / pushback
   * the user posted in their last comment. Empty on a first-pass run
   * (nothing for the researcher to answer back yet) or when the user's
   * last comment only contained answers to the researcher's prior
   * questions.
   */
  previousCommentAnswers: string;
}

export function parseResearcherQuestions(response: string): PrePlanQuestions {
  const empty: PrePlanQuestions = {
    hasQuestions: false,
    questions: [],
    openingSummary: "",
    codebaseContext: "",
    previousCommentAnswers: "",
  };
  if (!response) return empty;

  // Split on level-3 headings. The first chunk is the preamble (opener
  // line + summary paragraph); subsequent chunks each start with `### `.
  const chunks = response.split(/(?=^###\s+)/m);
  const preamble = chunks[0] ?? "";
  const openingSummary = extractOpeningSummary(preamble);

  const answersChunk = chunks.find((s) => /^###\s+Answers to your previous comment/i.test(s)) ?? "";
  const previousCommentAnswers = answersChunk
    ? answersChunk.replace(/^###\s+Answers to your previous comment[^\n]*\n/i, "").trim()
    : "";

  const contextChunk = chunks.find((s) => /^###\s+Codebase context/i.test(s)) ?? "";
  const codebaseContext = contextChunk
    ? contextChunk.replace(/^###\s+Codebase context[^\n]*\n/i, "").trim()
    : "";

  const questionsChunk = chunks.find((s) => /^###\s+Pre-plan questions/i.test(s));
  if (!questionsChunk) {
    return { ...empty, openingSummary, codebaseContext, previousCommentAnswers };
  }

  const body = questionsChunk
    .replace(/^###\s+Pre-plan questions[^\n]*\n/i, "")
    .trim();

  // `_none._`, `_none_`, or just `none` — case-insensitive — means no
  // questions. We accept a few minor variants because the researcher
  // sometimes drops the trailing dot or wraps in different markers.
  if (/^_?none\.?_?\s*$/im.test(body)) {
    return { ...empty, openingSummary, codebaseContext, previousCommentAnswers };
  }

  // Extract every bulleted line (`-` or `*` prefix). Ignore non-bullet
  // text — that's commentary from the researcher, not a question.
  const questions = body
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((q) => q.length > 0);

  return {
    hasQuestions: questions.length > 0,
    questions,
    openingSummary,
    codebaseContext,
    previousCommentAnswers,
  };
}

/**
 * Pull the one-paragraph summary that sits between the attribution line
 * (`**The Research Agent** completed pre-plan discovery for issue #N.`)
 * and the first `###` heading. Falls back to "" when the preamble is
 * empty or only contains the attribution line.
 */
function extractOpeningSummary(preamble: string): string {
  const lines = preamble.split("\n");
  const attrIdx = lines.findIndex((l) => /^\s*\*\*The Research Agent\*\*/i.test(l));
  if (attrIdx < 0) return "";

  const afterAttr = lines.slice(attrIdx + 1);
  const summaryLines = afterAttr.reduce<{ lines: string[]; done: boolean }>(
    (acc, line) => {
      if (acc.done) return acc;
      if (line.trim().length === 0) {
        return acc.lines.length > 0 ? { lines: acc.lines, done: true } : acc;
      }
      return { lines: [...acc.lines, line], done: false };
    },
    { lines: [], done: false },
  ).lines;

  return summaryLines.join("\n").trim();
}
