# TypeScript Component Injection — Design Spec

> Status: draft for review. No code yet. Pairs with the baseline benchmark
> at `src/benchmarks/component-cost.ts` (committed as `f1e3427`).

## Goal

Replace the markdown `<JDI:X />` component-tag mechanism with a TypeScript
component registry. Pivot motivation:

- **Validation.** Catch broken refs (`<JDI:Architect:Analyse />` is currently
  silent — there's no `Architect.md`). Type system rejects them at compile time.
- **Maintainability.** Single source of truth in TS; refactors become safe.
- **Real dependency model.** Transitive section deps work programmatically
  rather than by convention.
- **Latent token savings.** Up to **-18% tokens / -32% tool calls** per
  implement-plan run if authors take the new section-targeted shape seriously
  (numbers from baseline benchmark; raw 0–3% delta on today's whole-file tag
  corpus).

Out of scope: the user/project override chain (deemed redundant for the
pivot — TS source of truth replaces it).

---

## Component data model

```ts
// src/components/types.ts
export interface ComponentSection {
  /** Stable identifier referenced from tags (e.g. `Sandbox`, `Standards`). */
  readonly name: string;
  /** One-line summary used by `component list` and tooling. */
  readonly description: string;
  /** The actual content injected when this section is requested. */
  readonly body: string;
  /** Other sections this one depends on. Transitively resolved. */
  readonly requires?: readonly SectionRef[];
}

export type SectionRef =
  | string                              // shorthand for default section: "AgentBase"
  | { component: string; section: string }; // explicit: { component: "AgentBase", section: "Sandbox" }

export interface Component {
  readonly name: string;                 // e.g. "AgentBase"
  readonly category: ComponentCategory;  // narrow union, validated at compile time
  readonly description: string;
  readonly sections: Readonly<Record<string, ComponentSection>>;
  /** When a tag has no `:section`, return all sections concatenated in this
   *  order. Defaults to the order keys appear in `sections`. */
  readonly defaultOrder?: readonly string[];
}

export type ComponentCategory = "meta" | "execution" | "planning" | "quality";
```

Each component lives in its own file:

```
src/components/
  registry.ts                  // exports Record<string, Component> as the registry
  types.ts                     // shared types
  meta/
    AgentBase.ts
    AgentRouter.ts
    SilentDiscovery.ts
    StrictnessProtocol.ts
    ...
  execution/
    Verify.ts
    Commit.ts
    ...
  planning/
    TaskBreakdown.ts
    WaveComputation.ts
  quality/
    PRReview.ts
```

Each component file exports `default` of type `Component`. The registry is
auto-built from the directory at import time (Bun glob, just like
`convert-agents.ts`'s `Bun.Glob` pattern). No central registration boilerplate.

---

## Resolver API

```ts
// src/components/resolve.ts

/**
 * Resolve a component reference to injectable text.
 *
 * - `name` only: returns concatenated body of all sections in `defaultOrder`.
 * - `name + section`: returns just that section's body.
 * - Transitive deps resolve recursively. Cycles throw.
 */
export function getComponent(name: string, section?: string): string;

/** Metadata-only lookup for tooling (`component list`, `component info`). */
export function getComponentInfo(name: string): Component;

/** Returns null when the ref is bad. Callers can decide to throw or skip. */
export function tryResolve(ref: SectionRef): string | null;

/**
 * Validate the entire registry — every section's `requires` resolves, no
 * cycles. Called at build time and from `component validate` CLI.
 */
export function validateRegistry(): { ok: true } | { ok: false; errors: string[] };
```

Resolution rules:

1. `name` matches a key in the registry; otherwise throw with a suggestion
   from Levenshtein closest match.
2. `section` matches a key in `component.sections`; same fallback.
3. Transitive deps are concatenated **before** the requested section, in
   declaration order, deduplicated by `${component}:${section}` key.
4. The resolver caches resolved text per `(name, section)` key in-process —
   safe because components are immutable.

---

## Tag syntax in source files

Drop the XML-like `<...>` wrapping in favour of an `@`-prefixed reference.
Lighter on bytes, easier to type, doesn't look like a structural directive:

| Old                                      | New                          |
|------------------------------------------|------------------------------|
| `<JDI:AgentBase />`                      | `@ST:AgentBase`              |
| `<JDI:AgentBase:Sandbox />`              | `@ST:AgentBase:Sandbox`      |
| `<JDI:AgentRouter mode="discover" />`    | `@ST:AgentRouter:discover`   |
| `<JDI:Architect:Analyse />` (broken)     | rejected at compile time     |

Parser regex: `/@ST:([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z][A-Za-z0-9-]*))?/g`
— group 1 is the component name, optional group 2 is the section. Word
boundary terminates the tag (whitespace, punctuation, or end of line).

Tag attributes (`mode="x"` etc.) are dropped — never used by the new
resolver. The information they carried (e.g. `<JDI:AgentRouter mode="discover" />`)
becomes the section name (`@ST:AgentRouter:discover`).

---

## CLI surface

```
software-teams component list
  -> Markdown table: component | category | section count | total bytes

software-teams component list --json
  -> JSON array of all components and sections (for tooling)

software-teams component get <name>
  -> stdout: full component body (concatenated sections in defaultOrder)

software-teams component get <name> <section>
  -> stdout: just that section, plus transitively-required sections concatenated

software-teams component get <name> --json
  -> JSON: { name, sections: [{name, body, ...}], ... }

software-teams component validate
  -> Walks the registry + scans all framework markdown for @ST:Name(:Section)?
     tags; reports broken refs and cycles. Exits 1 on error.
     Wired into CI (extends the existing plugin-drift-check job).
```

The Bash allowlist already covers `Bash(software-teams:*)` so agents can call
this without further permissions.

---

## How consumers use it

**Default — sync-time inlining (B3).** Agents and skills get the heavy
discount: zero runtime tool calls, predictable bytes per spawn, cache-friendly.

```
framework/agents/software-teams-planner.md  (source)
   @ST:AgentRouter:discover
                |
                v
software-teams sync-agents  (build step)
                |
                v
.claude/agents/software-teams-planner.md   (output, ships)
   "...existing prose...
    [content of AgentRouter:discover and its transitive deps inlined here]
    ...rest of prose..."
```

`sync-agents` already exists; we extend `convert-agents.ts` to pre-process
`@ST:...` tags before writing output. Same code path applies to
`build-plugin` (the new plugin tree generation from Wave 3).

**Escape hatch — runtime injection (B1).** For the rare case where the
section choice depends on runtime data the agent only learns when spawned
(e.g., "load contract-check section if the task touches an API"), the agent
runs:

```
software-teams component get Verify contract-check
```

The output is appended to its working context. This costs one Bash call per
section but is the only path that supports dynamic resolution.

**Tagging itself.** `@ST:Name(:Section)?` tags written into source markdown
serve as both the inlining marker AND a human-readable signal that "doctrine
lives here". They survive in the source tree; they get expanded in the build
tree.

---

## Migration path

One-time, scripted.

1. **Convert markdown components to TS.** Walk `framework/components/**/*.md`,
   parse YAML frontmatter (already exists for `Verify.md`), parse `## Heading`
   boundaries (and existing `<section name="X">` blocks for AgentBase) into
   `ComponentSection[]`, write `src/components/{category}/{Name}.ts`. The
   markdown files stay as documentation/fallback for one release; CI fails if
   they drift from the TS source (similar to the plugin-drift-check pattern).
2. **Bulk-rename tags.** `<JDI:Name />` → `@ST:Name`,
   `<JDI:Name:Section />` → `@ST:Name:Section`,
   `<JDI:Name attr="x" />` → `@ST:Name:x` (attribute becomes section).
   Driven by a single regex pass with a small lookup for known
   attribute→section conversions (e.g. `mode="discover"` → `:discover`).
3. **Wire `sync-agents` to expand tags.** Extend `convert-agents.ts` to call
   `getComponent()` for every tag it finds before writing the output file.
4. **Add `software-teams component` CLI.** Wraps the resolver. Used by
   runtime-injection callers and tooling.
5. **Validate.** `software-teams component validate` must pass against the
   live tree. Wire into CI.
6. **Author follow-up audit (separate plan).** Walk the corpus of newly
   `@ST:Name` tags, identify which can be tightened to `@ST:Name:Section`,
   submit a PR per category. This is where the latent -14 to -18% token
   savings get realised.

---

## Validation rules

- Every `@ST:Name` references a registered component.
- Every `@ST:Name:Section` references an existing section.
- Section dependency graph is acyclic.
- Section names are unique within a component.
- Each component has at least one section.
- `defaultOrder` only references existing sections.

These run:

- At TS compile time (type-checked references).
- In `software-teams component validate` (string scan of framework markdown).
- In `software-teams sync-agents` (refuses to write if any tag fails).

---

## Observability

The benchmark stays as the canonical "did this pivot pay off" instrument.
After Stage 4 we re-run it and assert the projection numbers match. Plus:

- Add `--from-source` and `--from-resolved` flags to the benchmark so we can
  compare a pre-sync source spec (with tags) against a post-sync resolved
  spec (with content inlined). The resolved version is what the agent
  actually loads.
- Re-enable the spawn-ledger (`.software-teams/persistence/spawn-ledger.jsonl`)
  with real per-spawn byte counts, so production usage produces empirical
  numbers we can graph.

---

## Trade-offs and rejected alternatives

**Why not keep markdown components and add a separate validator?**
A linter on top of markdown gets us the broken-ref check but not the
type-safe API for resolving deps. Splitting the source of truth between
markdown and a TS validator is the worst of both. One source of truth is
the actual win.

**Why not JSON / YAML for components?**
The body is multi-line markdown that Claude reads. Storing it in TS strings
is the cleanest authoring path; JSON multi-line strings are painful and
YAML's whitespace rules are footguns.

**Why not strip tags entirely and inline directly into agent specs?**
Tags in the source serve as visual signals: "doctrine reused from elsewhere
lives here". That signal is valuable for human reviewers even after the
build inlines the content. Tags are cheap (~30 bytes each) and disappear at
sync time.

**Why drop the override chain?**
Today's chain (`project > user > builtin`) was implemented via "init copies
components into `.software-teams/framework/components/`" — which is
duplication, not override. Real overrides would need user TS authoring,
which raises the entry barrier. Defer to a future plan if customisation
requirements emerge.

---

## Out of scope (separate work items)

- Re-authoring tags as section-targeted (Stage 5+ audit).
- User-side overrides (deferred — design pivot drops them).
- An MCP server (Option B2 in the earlier discussion) — sync-time inlining
  is enough for now; revisit if structured returns are needed.
- Multi-section tags (e.g. `@ST:Name:A,B`) — dropped from v1 scope.
- Plan tier templates picking up the new tag syntax — covered when the
  corresponding template files are touched.
