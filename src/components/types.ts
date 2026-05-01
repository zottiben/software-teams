/**
 * Core types for the TypeScript component registry.
 *
 * These shapes are canonical — defined in `docs/typescript-injection-design.md`
 * §"Component data model". Downstream tasks (T2 resolver, T4 component bodies)
 * import from this file exclusively. Do NOT widen or alter field names/modifiers
 * without updating the design doc and all downstream consumers.
 */

/**
 * A named, injectable slice of a component. Tags of the form
 * `@ST:Name:Section` resolve to exactly one `ComponentSection.body`.
 */
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

/**
 * A cross-component section dependency reference.
 *
 * - Shorthand string: the default (whole-component) reference, e.g. `"AgentBase"`.
 * - Explicit object: a targeted section reference, e.g.
 *   `{ component: "AgentBase", section: "Sandbox" }`.
 */
export type SectionRef =
  | string // shorthand for default section: "AgentBase"
  | { component: string; section: string }; // explicit: { component: "AgentBase", section: "Sandbox" }

/**
 * Declarative parameter metadata for a component. The resolver IGNORES params
 * in v1 — they are surfaced via `getComponentInfo()` and the `component list`
 * CLI for documentation and tooling. Components like `Verify` declare params
 * (`scope`, `strict`, `include_tests`) so callers and reviewers see the
 * supported runtime knobs even though resolution doesn't apply them.
 *
 * Migrated 1:1 from the existing markdown frontmatter `params:` block
 * (see `framework/components/execution/Verify.md`).
 */
export interface ComponentParam {
  readonly name: string;
  readonly type: "string" | "boolean" | "number";
  readonly required: boolean;
  readonly default?: string | boolean | number;
  /** Closed enum of valid values for `type: "string"` params. Empty/omit means open. */
  readonly options?: readonly string[];
  readonly description: string;
}

/**
 * A typed component module — the unit of reuse in the component registry.
 *
 * Each component lives in its own file under `src/components/{category}/{Name}.ts`
 * and exports a `default` value of this type. The registry aggregates all
 * defaults into a `Record<string, Component>` keyed by `name`.
 *
 * Tags of the form `@ST:Name` or `@ST:Name:Section` are resolved at sync time
 * (via `convert-agents.ts`) or at runtime via the `getComponent()` resolver (T2).
 */
export interface Component {
  readonly name: string;                // e.g. "AgentBase"
  readonly category: ComponentCategory; // narrow union, validated at compile time
  readonly description: string;
  readonly sections: Readonly<Record<string, ComponentSection>>;
  /**
   * When a tag has no `:section`, return all sections concatenated in this
   * order. Defaults to the order keys appear in `sections`.
   */
  readonly defaultOrder?: readonly string[];
  /**
   * Optional declarative parameter metadata (from the legacy markdown
   * frontmatter `params:` block). Surfaced for tooling; not used by the
   * resolver in v1.
   */
  readonly params?: readonly ComponentParam[];
}

/**
 * The four top-level organisational categories for components, mirroring the
 * `framework/components/{category}/` directory layout.
 */
export type ComponentCategory = "meta" | "execution" | "planning" | "quality";
