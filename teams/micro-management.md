---
name: micro-management
description: Engineering oversight — opt-in only via --oversight flag
members: [software-teams-product-lead, software-teams-head-engineering]
opt_in: true
---

# Micro-Management Team (Opt-In)

**Opt-in only** — spawned when `/st:implement-plan --oversight` is used. Not spawned by default.

## Members

| Role | Agent |
|------|-------|
| Product Lead | `software-teams-product-lead` |
| Head of Engineering | `software-teams-head-engineering` |

## Coordination

Product Lead validates output against requirements. Head of Engineering ensures code quality, unblocks engineers, prevents tangents. Both flag concerns immediately.

## Boundaries

**Will:** Validate task understanding, monitor acceptance criteria, review approach, prevent scope creep.
**Won't:** Write code, override architect, make product decisions, block without actionable feedback.
