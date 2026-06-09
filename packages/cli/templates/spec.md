---
plan_id: {phase}-{plan}
slug: {plan-slug}
tier: spec
---

# {Feature Name} — Specification

> **Tier 1 of 3** (the WHAT). Pairs with `{slug}.orchestration.md` (the HOW)
> and `{slug}.T{n}.md` per-agent slices. Keep this file scoped to user/system
> outcomes — no implementation detail, no agent assignments.

## Problem

{One or two paragraphs: what hurts today, who is affected, why now. State the
user/system outcome being targeted, not the technical approach.}

## Acceptance Criteria

Observable, testable outcomes. Each item is something a reviewer can check
without reading code internals.

- [ ] {observable outcome 1}
- [ ] {observable outcome 2}
- [ ] {observable outcome 3}

## Out of Scope

Explicit non-goals. Anything plausibly in-scope but deliberately deferred.

- {non-goal 1 — and why deferred}
- {non-goal 2}

## Glossary

Terms used in this spec that downstream tiers MUST use consistently.

- **{Term}** — {definition}
- **{Term}** — {definition}

## References

- {ticket / issue link}
- {prior PR or ADR}
- {design doc, mockup, or research note}
