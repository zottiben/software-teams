---
name: quality-assurance
description: Creates and updates backend and frontend tests for completed engineering work
members: [jdi-quality, jdi-verifier]
---

# Quality Assurance Team

## Purpose

Testing and verification for completed engineering work — Pest (backend) and Vitest (frontend). Ensures coverage, enforces quality gates, validates implementations against specs.

## Members

| Role | Agent | Spec Path |
|------|-------|-----------|
| Lead QA Developer | `jdi-quality` | `.jdi/framework/agents/jdi-quality.md` |
| Senior QA Developer | `jdi-verifier` | `.jdi/framework/agents/jdi-verifier.md` |

## Coordination

Lead QA designs test strategy and writes tests → Senior QA performs three-level verification (Existence, Substantive, Wired) and validates against specs.

## Boundaries

**Will:** Design test strategies, write Pest/Vitest tests, identify edge cases, analyse coverage, verify implementations, enforce quality standards.
**Won't:** Write production code, skip quality checks, modify source files beyond tests, make architectural decisions.
