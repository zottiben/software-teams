# InteractiveGate Component

A reusable question gate that presents structured decisions to the user via `AskUserQuestion` before a phase transition. Questions are sourced from two channels: surface-level ambiguity detection and research-driven codebase analysis.

When a command references `@ST:InteractiveGate:...`, execute the steps below. Do NOT skip the merge/dedup logic even if only one source produces questions.

---

## Modes

| Mode | When | Question Sources |
|------|------|-----------------|
| `pre-plan` | Before planner spawn in `create-plan` | Surface-level analysis of feature description + `RESEARCH_QUESTIONS` from pre-plan research spawn |
| `blocker-resolution` | During implementation when a task is blocked | Surface-level analysis of the blocker description + context from the blocking task |

---

## Question Sources

### Surface-Level (Ambiguity Detection)

Analyse the feature description (or blocker description) for ambiguity signals:

- **Vague scope words** — "improve", "enhance", "refactor", "clean up", "optimise" without measurable targets
- **Missing tech stack specifics** — feature implies a technology choice but doesn't state one
- **Unclear boundaries** — "and more", "etc.", "various", "all the things"
- **Multiple possible approaches** — description could be solved in fundamentally different ways
- **Implicit assumptions** — feature assumes context the user hasn't stated

Generate questions only for genuine ambiguities. Do NOT manufacture questions for clear descriptions.

### Research-Driven

Consume the `RESEARCH_QUESTIONS` YAML block produced by the pre-plan research spawn (or equivalent). These are decision points discovered by analysing the actual codebase:

- Competing patterns (e.g. two state management approaches in use)
- Missing data/fields the feature will need
- Architectural choices (where to place new code, which module to extend)
- Dependency/library choices
- Existing conventions that constrain the approach

Research-driven questions arrive pre-formatted with `id`, `question`, `header`, `options`, and `context`.

---

## Merge and Prioritise

1. Collect surface-level questions (assign IDs `SQ-01`, `SQ-02`, ...)
2. Collect research-driven questions (IDs `RQ-01`, `RQ-02`, ... from the researcher)
3. Deduplicate: if a surface question covers the same decision as a research question, keep the research version (it has codebase-grounded options)
4. Sort: research-driven questions first (higher signal), then surface-level
5. Cap at a reasonable total — if more than 8 questions survive, drop the lowest-priority surface-level questions

---

## AskUserQuestion Format

Each question presented via `AskUserQuestion` must follow this structure:

- **`header`**: Short category tag — max 12 characters. Examples: `SCOPE`, `STACK`, `APPROACH`, `PATTERN`, `DATA`, `BOUNDARY`
- **`question`**: The actual question text. Clear, specific, and actionable.
- **`options`**: 2-4 options, each with:
  - `label`: Short option name
  - `description`: One-line explanation. For research-driven questions, ground this in what the researcher found in the codebase.
- **`multiSelect`**: Set to `true` only for non-mutually-exclusive choices. Default `false`.
- An automatic "Other" option is always available (built into the tool).

**Batching rule:** Maximum 4 questions per `AskUserQuestion` call (tool limit). If more than 4 questions survive merge, batch into multiple sequential calls. Present the highest-priority questions first.

---

## Output Format

Store all answers as `PRE_ANSWERED_QUESTIONS` in YAML:

```yaml
PRE_ANSWERED_QUESTIONS:
  - id: RQ-01
    source: research
    question: "The codebase uses both Redux and Zustand — which should this feature follow?"
    chosen: "Use Zustand"
    custom_text: null
  - id: SQ-01
    source: surface
    question: "What does 'improve performance' mean concretely?"
    chosen: "Reduce load time below 2s"
    custom_text: "Specifically the dashboard page load"
```

Fields:
- `id`: Question ID (`RQ-*` for research, `SQ-*` for surface)
- `source`: `research` or `surface`
- `question`: The question text (for downstream reference)
- `chosen`: The selected option label (or "Other" if custom)
- `custom_text`: User's free-text input if they chose "Other", otherwise `null`

---

## Skip Condition

If BOTH sources yield zero questions after analysis, skip the gate entirely. Do NOT present an empty AskUserQuestion call. Proceed directly to the next step in the parent workflow.

Log internally: `InteractiveGate: 0 questions from surface + 0 from research — skipping gate.`

---

## Fallback

If `AskUserQuestion` is not available (not in the skill's `allowed-tools` list), fall back to plain markdown:

```
Before we proceed, I have a few questions:

1. **[PATTERN]** The codebase uses both X and Y for Z — which should this feature follow?
   - A) Use X — consistent with src/foo/ (newer pattern)
   - B) Use Y — consistent with src/bar/ (legacy pattern)
   - C) Other (please specify)

2. **[SCOPE]** What does "improve" mean concretely?
   - A) Reduce load time below 2s
   - B) Reduce memory usage
   - C) Other (please specify)

Please respond with your choices (e.g. "1A, 2B") or provide details.
```

Parse the user's response and populate `PRE_ANSWERED_QUESTIONS` accordingly.

---

## Usage

```
@ST:InteractiveGate
```

Referenced within a skill's numbered workflow steps. Requires that question sources (surface analysis input and/or `RESEARCH_QUESTIONS` block) are available in the execution context before invocation.
