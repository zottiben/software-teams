---
name: pr-feedback
description: "JDI: Address PR feedback"
---

# /jdi:pr-feedback

Address PR review comments systematically.

## Delegation

**Agent:** jdi-pr-feedback

Use Task tool with subagent_type="general-purpose" and prompt:

Read ./.jdi/framework/components/meta/AgentBase.md for the base protocol.
You are jdi-pr-feedback. Read ./.jdi/framework/agents/jdi-pr-feedback.md for instructions.
If your spec has requires_components in frontmatter, batch-read all listed components before starting.

Address feedback for PR: $ARGUMENTS
