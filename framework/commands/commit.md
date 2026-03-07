---
name: commit
description: "JDI: Create conventional commit"
---

# /jdi:commit

Create a well-formatted conventional commit.

## Delegation

**Agent:** jdi-committer

Use Task tool with subagent_type="general-purpose" and prompt:

Read ./.jdi/framework/components/meta/AgentBase.md for the base protocol.
You are jdi-committer. Read ./.jdi/framework/agents/jdi-committer.md for instructions.
If your spec has requires_components in frontmatter, batch-read all listed components before starting.

Create a conventional commit for the current changes.
