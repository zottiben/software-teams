/**
 * component-drift.ts — Markdown ↔ TS drift check for the component registry.
 *
 * Implements the same parsing rules as T4 (migration):
 *   - AgentBase (no frontmatter): mixed `## Heading` + explicit `<section name="X">` blocks.
 *   - Verify / Commit / VerifyAdvanced (YAML frontmatter present): `<section name="X">` blocks
 *     for named sections; bare `## Heading` lines that appear outside a `<section>` block
 *     are also treated as sections (using the same heading-normalisation rule).
 *   - All other components: `## Heading` boundaries at depth-2, with trailing `(...)`
 *     parameter hints stripped from the section name.
 *
 * Comparison is plain string-equality after leading/trailing whitespace trim.
 * No diff library is used — this runs once per CI job.
 *
 * @see docs/typescript-injection-design.md §"Migration path" item 1
 * @see .software-teams/plans/3-01-component-system-pivot.T4.md §Implementation step 1
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { registry } from "../components/registry";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriftDiff {
  component: string;
  section: string;
  /** Body extracted from the TS module (source of truth). */
  expected: string;
  /** Body re-parsed from the markdown file. */
  actual: string;
}

export type DriftResult =
  | { ok: true }
  | { ok: false; diffs: DriftDiff[] };

export interface CheckComponentDriftOptions {
  /**
   * Absolute path to the `framework/` directory that contains
   * `components/{meta,execution,planning,quality}/*.md`.
   * Defaults to `<cwd>/framework`.
   */
  frameworkDir?: string;
}

// ─── Markdown parsing helpers ─────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Strip leading/trailing whitespace — the only normalisation T4 applied. */
/**
 * Trim leading/trailing whitespace, plus strip trailing markdown horizontal
 * rules (`---`) that authors use as visual separators between section blocks.
 * The TS migration in T4 treats those `---` lines as section terminators
 * rather than section content, so the drift parser must do the same to keep
 * comparison stable.
 */
function trim(s: string): string {
  return s.trim().replace(/\n\s*-{3,}\s*$/, "").trim();
}

/**
 * Strip trailing `(...)` parameter hints from a `## Heading` section name.
 *
 * Example: `## Task Verification (\`scope="task"\`)` → `"Task Verification"`
 *
 * Normalisation rule documented in T4 §Implementation step 1:
 * "any trailing `(...)` parameter hints stripped — e.g. `## Task Verification
 * (`scope="task"`)` → section name `"Task Verification"`"
 *
 * We strip everything from the first `(` that is not preceded by a word
 * character at the END of the heading, trimming the result.
 */
function normaliseHeadingName(raw: string): string {
  // Strip every trailing `(...)` block per T4 §step 1: "with any trailing
  // `(...)` parameter hints stripped". The rule is intentionally broad —
  // descriptive parens like `(6 Steps)` and parameter parens like
  // `(scope="task")` are both removed; sections must be addressable by a
  // canonical core name without parenthetical variation.
  return raw.replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * Parse sections from a markdown body that uses ONLY `<section name="X">` blocks.
 *
 * Used for Verify-like components (which have explicit `<section>` wrappers).
 * Sections that fall between `<section>` blocks (i.e. outside any wrapper)
 * are parsed as `## Heading` boundaries so we capture free-standing headings
 * like `## Default Behaviour` in Verify.md.
 *
 * Returns a record of { sectionName: trimmedBody }.
 */
function parseSectionBlocks(body: string): Record<string, string> {
  const sections: Record<string, string> = {};

  // Split by <section name="X"> ... </section> tags
  const SECTION_OPEN_RE = /<section name="([^"]+)">/g;
  const SECTION_CLOSE = "</section>";

  let cursor = 0;
  let match: RegExpExecArray | null;

  // Accumulate text between sections for `## Heading` parsing
  const interstitial: Array<{ text: string }> = [];

  while ((match = SECTION_OPEN_RE.exec(body)) !== null) {
    const sectionName = match[1];
    const blockStart = match.index + match[0].length;

    // Collect interstitial text before this block
    const before = body.slice(cursor, match.index);
    interstitial.push({ text: before });

    const closeIdx = body.indexOf(SECTION_CLOSE, blockStart);
    if (closeIdx === -1) {
      // Unclosed section — treat rest of file as body
      sections[sectionName] = trim(body.slice(blockStart));
      cursor = body.length;
      break;
    }

    const sectionBody = trim(body.slice(blockStart, closeIdx));
    sections[sectionName] = sectionBody;
    cursor = closeIdx + SECTION_CLOSE.length;
  }

  // Remaining text after last </section>
  interstitial.push({ text: body.slice(cursor) });

  // Parse ## headings from interstitial text
  for (const { text } of interstitial) {
    const headingSections = parseHeadingBoundaries(text);
    for (const [name, sBody] of Object.entries(headingSections)) {
      if (!(name in sections)) {
        sections[name] = sBody;
      }
    }
  }

  return sections;
}

/**
 * Parse sections from a markdown body using `## Heading` boundaries (depth-2).
 *
 * Each `## X` line starts a new section named `X` (after trailing-paren stripping).
 * The body is everything until the next `## ` line or EOF, trimmed.
 */
function parseHeadingBoundaries(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split("\n");

  let currentName: string | null = null;
  let currentLines: string[] = [];
  let inFence = false;

  function flush() {
    if (currentName !== null) {
      const sBody = trim(currentLines.join("\n"));
      if (sBody) {
        sections[currentName] = sBody;
      }
    }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }
    const h2match = !inFence ? line.match(/^## (.+)$/) : null;
    if (h2match) {
      flush();
      currentName = normaliseHeadingName(h2match[1]);
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Parse a markdown component file and return its sections as { name: body } pairs.
 *
 * Dispatches to the correct parsing strategy based on the component name:
 *   - AgentBase: mixed `## Heading` + `<section name="X">` blocks (no frontmatter)
 *   - All others with frontmatter: `<section name="X">` primary, `## Heading` fallback
 *   - All others without frontmatter: `## Heading` boundaries only
 */
function parseMarkdownComponent(
  _componentName: string,
  content: string,
): Record<string, string> {
  // Strip YAML frontmatter if present
  let body = content;
  const fmMatch = content.match(FRONTMATTER_RE);
  if (fmMatch) {
    body = fmMatch[2] ?? "";
  }

  // AgentBase uses mixed parsing: both ## Heading and <section> blocks coexist.
  // We use the same unified `parseSectionBlocks` (which also handles ## headings
  // from interstitial text) — this covers both strategies correctly.
  const hasExplicitSections = /<section name="/.test(body);

  if (hasExplicitSections) {
    // Unified parse: explicit <section> blocks + interstitial ## headings
    return parseSectionBlocks(body);
  } else {
    // Pure ## Heading boundary parsing
    return parseHeadingBoundaries(body);
  }
}

// ─── Category detection ───────────────────────────────────────────────────────

const CATEGORIES = ["meta", "execution", "planning", "quality"] as const;

function findMarkdownPath(
  frameworkDir: string,
  componentName: string,
): string | null {
  for (const cat of CATEGORIES) {
    const candidate = join(frameworkDir, "components", cat, `${componentName}.md`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Check whether the markdown component files under `frameworkDir/components/`
 * are in sync with the TS registry.
 *
 * For each registered component:
 *   1. Locate the corresponding `.md` file.
 *   2. Parse its sections using T4-equivalent rules.
 *   3. Compare each section body (trimmed) against the TS module's body.
 *
 * Returns `{ ok: true }` when all sections match, or
 * `{ ok: false; diffs: [...] }` listing every mismatch.
 *
 * Missing markdown files are treated as a drift diff (component present in TS
 * but no corresponding markdown — not expected during the retention window,
 * but surfaced rather than silently skipped).
 *
 * When the registry is empty (T4 not yet landed), returns `{ ok: true }` to
 * avoid false-failing CI before the migration runs.
 */
export async function checkComponentDrift(
  opts: CheckComponentDriftOptions = {},
): Promise<DriftResult> {
  const cwd = process.cwd();
  const frameworkDir = opts.frameworkDir ?? join(cwd, "framework");

  const registryKeys = Object.keys(registry);

  // Registry not yet populated (T4 pending) — exit cleanly.
  if (registryKeys.length === 0) {
    return { ok: true };
  }

  const diffs: DriftDiff[] = [];

  for (const key of registryKeys.sort()) {
    const component = registry[key];
    if (!component) continue;

    const mdPath = findMarkdownPath(frameworkDir, component.name);
    if (!mdPath) {
      // No markdown file found — treat every TS section as a diff
      for (const sectionName of Object.keys(component.sections)) {
        const section = component.sections[sectionName];
        if (!section) continue;
        diffs.push({
          component: component.name,
          section: sectionName,
          expected: section.body,
          actual: "(markdown file not found)",
        });
      }
      continue;
    }

    const mdContent = await Bun.file(mdPath).text();
    const mdSections = parseMarkdownComponent(component.name, mdContent);

    // Compare each TS section against its markdown counterpart
    for (const sectionName of Object.keys(component.sections)) {
      const tsSection = component.sections[sectionName];
      if (!tsSection) continue;

      const tsBody = trim(tsSection.body);
      const mdBody = mdSections[sectionName] !== undefined
        ? trim(mdSections[sectionName]!)
        : null;

      if (mdBody === null) {
        // Section exists in TS but not found in markdown
        diffs.push({
          component: component.name,
          section: sectionName,
          expected: tsBody,
          actual: "(section not found in markdown)",
        });
      } else if (tsBody !== mdBody) {
        diffs.push({
          component: component.name,
          section: sectionName,
          expected: tsBody,
          actual: mdBody,
        });
      }
    }
  }

  if (diffs.length === 0) {
    return { ok: true };
  }
  return { ok: false, diffs };
}
