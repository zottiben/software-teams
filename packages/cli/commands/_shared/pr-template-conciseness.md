# PR template conciseness rules

When filling a repo's PR template after implementation, the goal is a description a busy reviewer can skim in 30 seconds and decide whether to open the diff. Verbose, per-file enumerations defeat that — reviewers ALREADY have the diff. Apply these rules to the filled template:

## Description

- **1–2 sentences maximum.** State WHAT the change does in plain language, not HOW it does it. The diff shows the how; the description sets context.
- **No file names, function names, or class names in the description prose.** Save those for the Changes bullets (one mention each, max).
- **No prose summary of every modified file.** That's what the diff is for.

## Related links / linked issue

- Use the literal form `Closes #${issueNumber}` (or `Fixes #${issueNumber}` if the issue is a bug). This is the GitHub keyword that wires the Issue ↔ PR Development sidebar link.
- Do NOT write `Issue: <title> #N` or any other verbose form — `Closes #N` is enough; GitHub renders the title automatically.

## Changes section

- **One line per bullet.** No multi-sentence paragraphs. No nested sub-bullets unless the template explicitly asks.
- **Group by concern**, not by file. Examples of good grouping: `Backend:`, `Frontend:`, `Tests:`, `Config:`. Bad grouping: one bullet per file.
- **Don't enumerate every file.** "Removed unused endpoints at `/feasibility` with relevant tests + DTOs" is good. Listing six controllers + three data classes + three test files by name is noise — the diff has them.
- **Verbs first.** "Removed X" / "Added Y" / "Renamed A → B". Skip "We have updated the code so that…" filler.
- **Trust the reader.** If they want specifics, they'll open the diff. Your job is to help them decide WHETHER to open it.

## Screenshots

- If the template has a Screenshots section AND your change has no UI impact: `N/A — no UI changes` (one line). Don't pad with explanation.
- If there ARE UI changes you can't capture: say so briefly. Don't apologise.

## Notes

- Brief. Often `N/A`. Conversational tone is fine if the template uses it.
- Use this section for caveats reviewers need to know (manual data migration required, follow-up PR planned, env var must be set), NOT for re-summarising the change.

## What good looks like

The point isn't to be terse for the sake of it — it's to respect the reviewer's attention. A good filled template reads like a quick teammate handover, not a compliance report.
