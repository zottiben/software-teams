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
  return comment.replace(SALUTATION_RE, "").trim().replace(FILLER_RE, "").trim();
}

export function parseComment(
  comment: string,
  isFollowUp: boolean,
): ParsedIntent | null {
  const hasDryRun = /--dry-run/i.test(comment);
  const cleanComment = comment.replace(/--dry-run/gi, "").trim();
  const match = cleanComment.match(/hey\s+software[\s-]?teams\s+(.+)/is);
  const body = match ? match[1].trim() : isFollowUp ? stripFollowUpSalutation(cleanComment) : null;
  if (body === null) return null;

  const clickUpMatch = body.match(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i);
  const clickUpUrl = clickUpMatch ? clickUpMatch[1] : null;

  const description = body
    .replace(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = body.toLowerCase();

  const base = { clickUpUrl, fullFlow: false, isFeedback: false, isApproval: false, dryRun: hasDryRun };

  if (/\b(approved?|lgtm|looks?\s*good|ship\s*it)\b/i.test(lower)) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true, isApproval: true };
  }

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
