import { consola } from "consola";
import { savePersistedState } from "../../../utils/storage-lifecycle";
import {
  postGitHubComment,
  updateGitHubComment,
  formatSoftwareTeamsComment,
} from "../../../utils/github";
import { setLifecycleLabel } from "../../../utils/labels";
import { parseResearcherQuestions } from "../../../utils/researcher-output";
import { buildRouterPrompt, type ActionContext } from "../router-prompts";
import { createStorage } from "../../../storage";
import { spawnDiscovery } from "./spawner";
import type { ParsedIntent } from "./types";

/**
 * Spawn the pre-plan researcher and return its markdown findings.
 *
 * Mirrors `commands/create-plan.md` §4a: before the Planning Agent runs,
 * we spawn `software-teams-researcher` in `pre-plan-discovery` mode to
 * survey the workspace, surface codebase context, and report genuine
 * pre-plan questions the issue text doesn't pin down. The findings are
 * threaded into the planner's brief as a `## Discovery findings` block.
 *
 * Failure (non-zero exit, empty response) is non-fatal — the caller
 * falls back to running the planner without findings, same as today's
 * behaviour. We log a warning so the operator can spot it in the run.
 */
export async function runPrePlanDiscovery(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  rulesBlock: string[];
  conversationHistory: string;
}): Promise<string> {
  const discoveryCtx: ActionContext = {
    flow: { kind: "pre-plan-discovery" },
    userRequest: opts.intent.description,
    repo: opts.repo ?? "",
    issueNumber: opts.issueNumber,
    conversationHistory: opts.conversationHistory,
    projectLines: opts.projectLines,
    workspaceLines: opts.workspaceLines,
    rulesBlock: opts.rulesBlock,
  };
  const discoveryPrompt = buildRouterPrompt(discoveryCtx);
  consola.info("Running pre-plan discovery (Research Agent)...");
  try {
    const result = await spawnDiscovery({ prompt: discoveryPrompt, cwd: opts.cwd });
    if (result.exitCode !== 0 || !result.response.trim()) {
      consola.warn(
        `Pre-plan discovery returned no findings (exit ${result.exitCode}) — planner will run without them`,
      );
      return "";
    }
    consola.success(`Pre-plan discovery captured ${result.response.length} bytes of findings`);
    return result.response;
  } catch (err) {
    consola.warn(`Pre-plan discovery failed; planner will run without findings: ${err}`);
    return "";
  }
}

/**
 * Format a "🔮 A few questions before I plan" comment body from the
 * researcher's surfaced pre-plan questions. Wrapped by
 * `formatSoftwareTeamsComment("questions", …)` at the post site so the
 * comment header + invisible marker land consistently.
 *
 * Includes the researcher's opening summary inline and the full
 * `### Codebase context` section inside a collapsible `<details>` block,
 * so the user can see HOW the researcher arrived at the questions —
 * otherwise wrongly-framed questions land with no anchor for the user
 * to correct the underlying reasoning (e.g. researcher fingered the
 * wrong app in the monorepo, user has no way to tell without the
 * context).
 */
export function formatQuestionsCommentBody(opts: {
  questions: string[];
  issueNumber: number;
  openingSummary: string;
  codebaseContext: string;
  previousCommentAnswers: string;
  // True when this is a follow-up researcher pass (i.e. there's
  // already at least one assistant comment in the thread). On
  // follow-ups, the opening summary becomes noise — the user already
  // knows the project shape from the first pass. Only emit it on
  // the FIRST pass.
  isFollowUp: boolean;
}): string {
  const {
    questions,
    issueNumber,
    openingSummary,
    codebaseContext,
    previousCommentAnswers,
    isFollowUp,
  } = opts;

  const hasQuestions = questions.length > 0;
  const hasAnswers = previousCommentAnswers.trim().length > 0;

  // Intro line — phrased to match what's actually in the comment.
  // Three cases: answers+questions, answers only, questions only.
  let intro: string;
  if (hasAnswers && hasQuestions) {
    intro = `The Research Agent has answers to your last comment plus a few remaining questions before producing a plan for issue #${issueNumber}. Reply when ready and the plan will continue.`;
  } else if (hasAnswers) {
    intro = `The Research Agent has answers to your last comment for issue #${issueNumber}. Reply to confirm or push further — the planner will run on your next message.`;
  } else {
    intro = `The Research Agent surveyed the codebase and has a few questions before producing a plan for issue #${issueNumber}. Answer them in a follow-up comment on this issue and the plan will continue.`;
  }
  const lines: string[] = [intro, ``];

  // Opening summary fires only on the FIRST researcher pass. By
  // round 2+ the user knows what stack we're in; repeating it on
  // every reply adds noise (real complaint observed on issue 6206).
  if (openingSummary && !isFollowUp) {
    lines.push(`**Researcher's read on the codebase:** ${openingSummary}`);
    lines.push(``);
  }

  // Answers go ABOVE questions — they respond directly to the user's
  // most recent message, so they're the first thing the reader wants
  // to see when they come back to the issue.
  if (hasAnswers) {
    lines.push(`### Answers to your last comment`);
    lines.push(``);
    lines.push(previousCommentAnswers);
    lines.push(``);
  }

  if (hasQuestions) {
    lines.push(`### Questions`);
    lines.push(``);
    for (const q of questions) lines.push(`- ${q}`);
    lines.push(``);
  }

  if (codebaseContext) {
    lines.push(`<details>`);
    lines.push(`<summary><strong>How I got here — codebase context</strong> (expand to see what the researcher found)</summary>`);
    lines.push(``);
    lines.push(codebaseContext);
    lines.push(``);
    lines.push(`</details>`);
    lines.push(``);
    lines.push(`_If any of this context is wrong, say so in your reply — the next pass will re-research with your correction in the conversation history._`);
    lines.push(``);
  }

  if (hasQuestions) {
    lines.push(`_(I'll skip the plan until I have your answers — no plan files have been written yet.)_`);
  } else {
    lines.push(`_(No plan files written yet — reply when you're satisfied and the plan will proceed.)_`);
  }
  return lines.join("\n");
}

/**
 * Run the pre-plan researcher and gate the rest of the plan flow on its
 * output. When the researcher surfaces genuine pre-plan questions, the
 * runner posts a comment containing JUST those questions and exits — the
 * planner does NOT run, no plan files are written. The user replies in a
 * follow-up comment; on the next run the researcher sees their answers
 * in the conversation history and either returns `_none._` (plan
 * proceeds) or asks remaining questions (gate re-fires).
 *
 * Returns:
 *   - `{ findings, aborted: false }` — proceed to planner.
 *   - `{ findings: "", aborted: true }` — comment posted; caller MUST
 *     return / exit without running the planner.
 *
 * Mirrors `commands/create-plan.md` §4b ("Pre-Planning Questions
 * (Interactive Gate)") for the headless action context — AskUserQuestion
 * isn't available here, so we use issue comments as the human-in-loop
 * channel.
 */
export async function runDiscoveryAndGate(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  rulesBlock: string[];
  conversationHistory: string;
  placeholderCommentId: number | null;
  storage: ReturnType<typeof createStorage> extends Promise<infer S> ? S : never;
  // True when there's already at least one assistant comment in the
  // thread. Passed through to `formatQuestionsCommentBody` so it can
  // skip the verbose opening-summary line on follow-up replies.
  isFollowUp?: boolean;
}): Promise<{ findings: string; aborted: boolean }> {
  const findings = await runPrePlanDiscovery({
    cwd: opts.cwd,
    repo: opts.repo,
    issueNumber: opts.issueNumber,
    intent: opts.intent,
    projectLines: opts.projectLines,
    workspaceLines: opts.workspaceLines,
    rulesBlock: opts.rulesBlock,
    conversationHistory: opts.conversationHistory,
  });

  const parsed = parseResearcherQuestions(findings);
  // Gate fires ONLY when the researcher has remaining questions. The
  // earlier behaviour (also firing when answers were present, even
  // with `_none._` for questions) was causing a frustrating extra
  // round-trip on issue 6206: the user answered the final question,
  // the researcher emitted an acknowledging "answers" block + no
  // remaining questions, the gate fired anyway, the user had to
  // comment AGAIN ("proceed with the plan") for the planner to run.
  //
  // The answers section is still useful when paired WITH remaining
  // questions (the user sees the researcher's reasoning alongside
  // what's still open). When there are no remaining questions, just
  // proceed to the planner — the answers are still in the planner's
  // brief via the discovery findings, so they're not lost.
  if (!parsed.hasQuestions) {
    return { findings, aborted: false };
  }

  const hasAnswers = parsed.previousCommentAnswers.trim().length > 0;
  consola.info(
    `Researcher pre-plan gate firing — questions: ${parsed.questions.length}, has-answers: ${hasAnswers}`,
  );
  if (opts.repo && opts.issueNumber) {
    const body = formatQuestionsCommentBody({
      questions: parsed.questions,
      issueNumber: opts.issueNumber,
      openingSummary: parsed.openingSummary,
      codebaseContext: parsed.codebaseContext,
      previousCommentAnswers: parsed.previousCommentAnswers,
      isFollowUp: opts.isFollowUp ?? false,
    });
    const finalBody = formatSoftwareTeamsComment("questions", body);
    if (opts.placeholderCommentId) {
      await updateGitHubComment(opts.repo, opts.placeholderCommentId, finalBody).catch((err) => {
        consola.error("Failed to update placeholder with questions:", err);
      });
    } else {
      await postGitHubComment(opts.repo, opts.issueNumber, finalBody).catch((err) => {
        consola.error("Failed to post questions comment:", err);
      });
    }
    // Lifecycle label: researcher is waiting on the user.
    await setLifecycleLabel(opts.repo, opts.issueNumber, "questions-pending").catch(() => {});
  }

  // Persist whatever state the researcher's run accumulated (rules etc.)
  // so the next run picks up where this one left off.
  await savePersistedState(opts.cwd, opts.storage).catch(() => {});

  return { findings: "", aborted: true };
}
