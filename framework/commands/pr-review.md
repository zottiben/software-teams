---
name: pr-review
description: "JDI: Review pull request"
---

# /jdi:pr-review

Review a pull request with learnings-aware analysis.

## Flags

- `--no-comments` — Do not post comments to GitHub. Write review to `.jdi/reviews/PR-{number}-review.md` instead.

## Delegation

Parse flags from $ARGUMENTS. Map `--no-comments` to `post="false"`.

Use Task tool with subagent_type="general-purpose" and prompt:

Read ./.jdi/framework/components/meta/AgentBase.md for the base protocol.

Read learnings before reviewing — these represent the team's coding standards and MUST be cross-referenced during review:
- Always read: `.jdi/framework/learnings/general.md`
- For PHP/Laravel PRs: also read `.jdi/framework/learnings/backend.md`
- For React/TypeScript PRs: also read `.jdi/framework/learnings/frontend.md`
- For test changes: also read `.jdi/framework/learnings/testing.md`
- For CI/Docker changes: also read `.jdi/framework/learnings/devops.md`
Apply learnings as additional review criteria — flag violations and praise adherence.

Read ./.jdi/framework/components/quality/PRReview.md for review instructions.
{If --no-comments flag was present: Include `post="false"` parameter — invoke as `<JDI:PRReview post="false" />`}

Review PR: $ARGUMENTS
