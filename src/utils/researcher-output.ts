/**
 * Parser for the pre-plan researcher's `### Pre-plan questions` section.
 *
 * The Research Agent's response shape (mandated by
 * `buildPrePlanDiscoveryBrief` in `router-prompts.ts`) always includes a
 * `### Pre-plan questions` section whose body is either:
 *
 *   - the literal `_none._` (with or without trailing dot), or
 *   - a bulleted list of questions, one per line.
 *
 * The action runner uses this parser to decide whether the planning run
 * can proceed (no questions) or must abort and surface the questions as
 * an issue comment for the user to answer (Phase C headless ambiguity
 * gate). When the researcher's output is malformed or the section is
 * missing entirely, the parser conservatively returns `hasQuestions:
 * false` — better to let the planner run than block on a parse error.
 */

export interface PrePlanQuestions {
  hasQuestions: boolean;
  questions: string[];
}

export function parseResearcherQuestions(response: string): PrePlanQuestions {
  if (!response) return { hasQuestions: false, questions: [] };

  // Split on level-3 headings; find the one labelled "Pre-plan questions".
  const sections = response.split(/(?=^###\s+)/m);
  const questionsSection = sections.find((s) => /^###\s+Pre-plan questions/i.test(s));
  if (!questionsSection) return { hasQuestions: false, questions: [] };

  const body = questionsSection
    .replace(/^###\s+Pre-plan questions[^\n]*\n/i, "")
    .trim();

  // `_none._`, `_none_`, or just `none` — case-insensitive — means no
  // questions. We accept a few minor variants because the researcher
  // sometimes drops the trailing dot or wraps in different markers.
  if (/^_?none\.?_?\s*$/im.test(body)) {
    return { hasQuestions: false, questions: [] };
  }

  // Extract every bulleted line (`-` or `*` prefix). Ignore non-bullet
  // text — that's commentary from the researcher, not a question.
  const questions = body
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((q) => q.length > 0);

  return { hasQuestions: questions.length > 0, questions };
}
