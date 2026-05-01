# Migration: Component System Pivot (`<JDI:` → `@ST:`, markdown → TypeScript)

This release replaces the markdown component layer with a typed TypeScript
component registry and swaps the source-syntax for component references from
`<JDI:Name(:Section)?>` to `@ST:Name(:Section)?`. Resolution still happens at
sync time — the agents Claude Code loads are fully expanded markdown — so the
runtime contract is unchanged. What changes is how authors write components
and reference them, and the build-time guarantees you get for free.

> Companion docs: canonical design in
> [`typescript-injection-design.md`](./typescript-injection-design.md).
> Sibling migration notes:
> [`migration-rebrand-software-teams.md`](./migration-rebrand-software-teams.md)
> and [`migration-native-subagents.md`](./migration-native-subagents.md).

---

## What changed

- **Source syntax.** `<JDI:Name />` and `<JDI:Name:Section />` are gone from
  every committed file under `framework/`, `.claude/`, and
  `.software-teams/plans/`. The new form is `@ST:Name` (whole component) or
  `@ST:Name:Section` (single section). Tag grammar:
  `/@ST:([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z][A-Za-z0-9-]*))?/g`.
- **Component layer.** All 16 doctrine components moved from
  `framework/components/{category}/{Name}.md` to
  `src/components/{category}/{Name}.ts`. Each module exports a typed
  `default: Component` (see `src/components/types.ts`). The TS modules are
  the source of truth. The markdown files survive one release as
  drift-checked documentation — see
  [Markdown retirement timeline](#markdown-retirement-timeline) below.
- **Sync-time inlining.** `software-teams sync-agents` rewrites every `@ST:`
  tag to its resolved body before writing `.claude/agents/{name}.md`. Source
  agent specs keep the tag as a visual signal; the generated outputs are
  fully expanded.
- **CLI surface.** New singular `software-teams component` subcommand with
  `get`, `list`, and `validate` actions. The legacy plural
  `software-teams components` is removed.
- **CI gate.** The existing `plugin-drift-check` job runs
  `software-teams component validate` as a new step. Broken `@ST:`
  references fail CI — the historical silent
  `<JDI:Architect:Analyse />` regression cannot recur.

---

## Authoring guide

### 1. Add a new component

Create the module under the matching category:

```ts
// src/components/quality/MyComponent.ts
import type { Component } from "../types";

const MyComponent: Component = {
  name: "MyComponent",
  category: "quality",
  description: "One-line summary used by `component list`.",
  sections: {
    Default: {
      name: "Default",
      description: "Whole-component default body.",
      body: `Markdown content goes here.`,
    },
    Detail: {
      name: "Detail",
      description: "Targeted section referenced as @ST:MyComponent:Detail.",
      body: `More markdown.`,
      // Optional: declare cross-section or cross-component dependencies.
      requires: [{ component: "AgentBase", section: "Sandbox" }],
    },
  },
  defaultOrder: ["Default", "Detail"],
};

export default MyComponent;
```

Frontmatter parameters that used to live in the markdown YAML head map
1:1 to the optional `params` array (see
`src/components/execution/Verify.ts` for a full example).

### 2. Register it

Edit `src/components/registry.ts`:

```ts
import MyComponent from "./quality/MyComponent";

export const registry = Object.freeze({
  // ...existing entries...
  [MyComponent.name]: MyComponent,
});
```

Imports are explicit (no glob magic) so the registry stays deterministic
and tree-shakeable.

### 3. Reference it in a spec or skill

In any source markdown under `framework/` or `.software-teams/plans/`:

```markdown
@ST:MyComponent              <!-- inlines the whole component (defaultOrder) -->
@ST:MyComponent:Detail       <!-- inlines just the Detail section -->
```

Run `software-teams sync-agents` to expand the tags into
`.claude/agents/{name}.md`.

### 4. Test it

```bash
bun test src/components/registry.test.ts
bun test src/components/resolve.test.ts
bun test src/components/validate.test.ts
software-teams component validate
```

Compile-time checks (`bun run build`) catch type-level regressions; the
validator catches broken `@ST:` references in the markdown corpus.

---

## CLI surface

```bash
# Show all registered components, grouped by category.
software-teams component list

# Print the resolved body for a tag (whole component).
software-teams component get AgentBase

# Print the resolved body for a single section.
software-teams component get AgentBase Sandbox

# Scan the framework markdown corpus for `@ST:` references and
# fail-closed on any broken name or section.
software-teams component validate
```

`component validate` runs in CI as a step inside the `plugin-drift-check`
job and exits non-zero on the first broken ref. There is no separate
`components` (plural) command — it was removed in this release.

---

## Token savings (T16 benchmark)

The benchmark in `src/benchmarks/component-cost.ts` measures one
`implement-plan` run end-to-end. Output appended to
`.software-teams/persistence/component-bench.jsonl`. Comparing the
`mode: "from-resolved"` entries:

| Run               | Tokens  | Tool calls |
|-------------------|---------|-----------:|
| Baseline (pre-pivot) | 51,249  | 28         |
| Post-migration       | 40,936  | 19         |
| **Delta**            | **-20.1%** | **-32%** |

The design doc projected a best-case ceiling of 42,009 tokens / 19 tool
calls (-18% / -32%). Actual delta against that ceiling is **-2.55%**
(favourable; soft-fail accepted in the wave-6 review). REQUIREMENTS risk
**R-06** is closed.

---

## Markdown retirement timeline

> **This PR does NOT delete the markdown component files.** The 16 files
> under `framework/components/{meta,execution,planning,quality}/*.md`
> stay in place as drift-checked documentation for one release window.

- **Now (this release).** TS modules are the source of truth. Markdown
  files are pinned to match the TS bodies; CI fails on drift.
- **One release window.** Markdown remains as human-readable reference
  for reviewers who prefer it over the TS modules. Authors MUST edit the
  TS module — markdown edits are reverted by the drift check.
- **Follow-up plan (T19 gate).** A separate, human-approved plan
  authorises the actual deletion of `framework/components/**/*.md` once
  the retention window has elapsed and there are no outstanding
  references. That plan is out of scope for this PR set.

If you have local tooling that reads the markdown components directly,
switch it to `software-teams component get <Name> [Section]` (or import
`getComponent` from `src/components`) before the follow-up deletion
lands.

---

## Rollback

The pivot landed as a coherent PR set on the
`3-01-component-system-pivot` plan. Rollback is a clean revert of that
PR set:

```bash
gh pr list --search "3-01-component-system-pivot" --state merged
git revert <merge-commits-in-reverse-order>
```

After revert:

- `framework/components/**/*.md` is the source of truth again.
- Source-syntax is `<JDI:Name(:Section)?>` again.
- Drop the `software-teams component` CLI step from
  `.github/workflows/ci.yml`'s `plugin-drift-check` job.

There is no feature flag — sync-time inlining is unconditional. The
markdown files surviving this release window mean a revert leaves
authors with a usable component layer immediately.
