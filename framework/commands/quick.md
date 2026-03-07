---
name: quick
description: "JDI: Quick focused change"
---

# /jdi:quick

Execute a small, focused change directly without full orchestration.

## Direct Execution

1. Parse task from $ARGUMENTS
2. Detect tech stack from target files
3. Execute changes directly (no agent spawn, no team, no waves)
4. Run verification gates
5. Commit with conventional format
6. Brief state update (if .jdi/ exists)
