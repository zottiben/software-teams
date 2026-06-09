import type { ParsedIntent } from "./types";

/**
 * Strip a generic salutation prefix from a follow-up comment so the
 * downstream command-keyword checks (`startsWith("implement")` etc) can
 * still see the user's verb.
 *
 * Catches the common conversational openers people use when replying to
 * the assistant in-thread — "Hey AI ...", "Hi bot ...", "@<botname> ...",
 * "yo claude ...", etc — without trying to be a general greeting parser.
 * Strips at most one salutation token (the greeting word + the name/handle
 * that follows it). If the comment doesn't start with a recognised
 * salutation, returns the comment unchanged.
 *
 * Intentionally conservative: only fires on a single leading word from
 * a short whitelist of greetings, optionally followed by a comma. We
 * never want to silently swallow real content — e.g. "implement the
 * plan" must reach the keyword checks unchanged, "Can you also add
 * tests?" must NOT have "Can you" stripped (and end up parsed as some
 * weird "also" command).
 */
function stripFollowUpSalutation(comment: string): string {
  // Two-pass strip.
  //
  // Pass 1 — strip a leading greeting token + optional bot/AI name/handle.
  //
  //   "Hey AI implement the plan"        → "implement the plan"
  //   "Hi @software-teams-bot lgtm"      → "lgtm"
  //   "Yo Claude, can you review this?"  → "can you review this?"
  //   "Hi bot, please implement"         → "please implement"   (pass 1)
  //   "implement the plan"               → "implement the plan" (no change)
  //
  // Pass 2 — strip a single leading politeness filler ("please" / "ok" /
  // "okay") if present. These often sit between a greeting and the
  // actual verb and would otherwise hide the command word from the
  // `startsWith` checks downstream.
  //
  //   "please implement"                 → "implement"          (pass 2)
  //   "ok approve"                       → "approve"            (pass 2)
  //   "Can you implement?"               → "Can you implement?" (unchanged
  //                                       — questions stay as feedback)
  const SALUTATION_RE =
    /^(?:hey|hi|hello|yo|@?software[-\s]?teams\b)(?:[,\s]+(?:@?[\w-]{1,40}))?[,\s]*/i;
  const FILLER_RE = /^(?:please|ok|okay)[,\s]+/i;
  let s = comment.replace(SALUTATION_RE, "").trim();
  s = s.replace(FILLER_RE, "").trim();
  return s;
}

export function parseComment(
  comment: string,
  isFollowUp: boolean,
): ParsedIntent | null {
  // Detect --dry-run flag in comment body
  const hasDryRun = /--dry-run/i.test(comment);
  const cleanComment = comment.replace(/--dry-run/gi, "").trim();

  // Strip "Hey Software Teams" trigger prefix (case-insensitive; accepts
  // both spaced and hyphenated forms). Repos that configure a different
  // `trigger_phrase` on the action input still pass through this branch
  // when the user types our default phrase — and pass through the
  // looseSalutation fallback below when they type the configured one
  // (e.g. "Hey AI implement the plan").
  const match = cleanComment.match(/hey\s+software[\s-]?teams\s+(.+)/is);

  // `body` is the comment with the salutation removed — that's what we
  // run command-keyword checks against. Two ways to get one:
  //   1. The official trigger regex matched — use the captured tail.
  //   2. Trigger failed AND this is a follow-up reply — strip any
  //      generic salutation ("Hey <bot>", "Hi <bot>", "@<bot>", "yo <bot>")
  //      so we can still recognise explicit command keywords like
  //      "implement" / "approve" / "review". This is the regression fix
  //      for "Hey AI implement the plan" (and any variant where a
  //      casual or per-repo-configured salutation drops the comment out
  //      of the strict regex). Without it, every follow-up gets routed
  //      to feedback even when the user clearly asked for a different
  //      action.
  let body: string | null = null;
  if (match) {
    body = match[1].trim();
  } else if (isFollowUp) {
    body = stripFollowUpSalutation(cleanComment);
  }
  if (body === null) return null;

  // Extract ClickUp URL if present
  const clickUpMatch = body.match(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i);
  const clickUpUrl = clickUpMatch ? clickUpMatch[1] : null;

  // Remove the URL from the body for cleaner description
  const description = body
    .replace(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = body.toLowerCase();

  const base = { clickUpUrl, fullFlow: false, isFeedback: false, isApproval: false, dryRun: hasDryRun };

  // "approved" / "lgtm" / "looks good" — explicit approval (does NOT trigger implementation)
  // Must be checked BEFORE command prefixes so "plan approved" is treated as approval, not a new plan.
  if (/\b(approved?|lgtm|looks?\s*good|ship\s*it)\b/i.test(lower)) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true, isApproval: true };
  }

  // Explicit commands always start a new workflow
  if (lower.startsWith("ping") || lower.startsWith("status")) {
    return { ...base, command: "ping", description: "", clickUpUrl: null };
  }
  if (lower.startsWith("plan ")) {
    return { ...base, command: "plan", description };
  }
  if (lower.startsWith("implement")) {
    return { ...base, command: "implement", description };
  }
  if (lower.startsWith("quick ")) {
    return { ...base, command: "quick", description };
  }
  if (lower.startsWith("review")) {
    return { ...base, command: "review", description };
  }
  if (lower.startsWith("feedback")) {
    return { ...base, command: "feedback", description };
  }

  // "do" triggers full flow (plan + implement) if ClickUp URL present
  if (lower.startsWith("do ")) {
    if (clickUpUrl) {
      return { ...base, command: "plan", description, fullFlow: true };
    }
    return { ...base, command: "quick", description };
  }

  // If there's an existing conversation, treat ambiguous trigger-prefixed
  // messages as refinement feedback. Also fires for the loose-salutation
  // branch above — if we stripped a casual salutation but found no
  // explicit command keyword, the comment is free-form feedback
  // ("can you also add tests?", "what about the edge case where...").
  if (isFollowUp) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true };
  }

  // Default: treat as new plan request
  return { ...base, command: "plan", description };
}
