---
name: generate-pr
description: "JDI: Generate pull request"
---

# /jdi:generate-pr

Generate a comprehensive PR description and create the pull request.

## Delegation

**Agent:** jdi-pr-generator

Use Task tool with subagent_type="general-purpose" and prompt:

Read ./.jdi/framework/components/meta/AgentBase.md for the base protocol.
You are jdi-pr-generator. Read ./.jdi/framework/agents/jdi-pr-generator.md for instructions.

Generate PR for current branch: $ARGUMENTS
