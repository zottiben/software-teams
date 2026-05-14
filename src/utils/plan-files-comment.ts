/**
 * Plan-files comment block.
 *
 * After the planner subagent writes SPEC + ORCHESTRATION + per-agent slices
 * to `.software-teams/plans/`, the action runner appends a "Plan files"
 * section to the comment it posts on the issue. The section embeds each
 * file's content inside a collapsible `<details>` block so the user can
 * actually read the plan in the GitHub UI before approving — instead of
 * staring at workspace-relative paths that link to nothing.
 *
 * The runner owns this section (not the planner's text) because:
 *   - the planner has no way to read its own output and embed it
 *   - the runner already calls `findActiveOrchestration` to discover the
 *     paths in question, so reading the files is one more `readFileSync`
 *   - keeping the formatter on the runner side means any future change to
 *     the embed format ships in the action's binary, not in a planner
 *     prompt template
 *
 * GitHub caps issue comments at 65,536 characters. We budget a soft cap
 * for the embedded content and truncate per-file when over budget; the
 * comment header + agent text + section scaffolding sit outside the cap.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentTypeToRoleLabel, type ActiveOrchestration } from "./orchestration";

/** Soft budget for the entire plan-files section. */
const SOFT_BUDGET_CHARS = 50_000;

/** When truncating a single file, keep at most this many leading chars. */
const PER_FILE_TRUNCATION_TARGET = 8_000;

/** Hard floor — every file gets at least this many chars before truncation. */
const PER_FILE_MIN_CHARS = 2_000;

export interface PlanFileEntry {
  /** Display label, e.g. "SPEC", "ORCHESTRATION", "TASK T1 (The Frontend Agent)". */
  label: string;
  /** Workspace-relative path, shown to the user verbatim. */
  path: string;
  /** Raw file content (or empty string if read failed). */
  content: string;
  /** True if we couldn't read the file from disk. */
  missing?: boolean;
}

/**
 * Read SPEC, ORCHESTRATION, and every per-agent slice from disk in the
 * order a reviewer would want to consume them. `findActiveOrchestration`
 * has already validated that the orchestration file exists; the slices
 * came from its `task_files:` frontmatter so they should exist too — but
 * we tolerate missing files (mark as `missing: true`) rather than
 * throwing, because a partial section is more useful than no section.
 */
export function readPlanFiles(
  cwd: string,
  orch: ActiveOrchestration,
): PlanFileEntry[] {
  const entries: PlanFileEntry[] = [];

  if (orch.specPath) {
    entries.push(readEntry(cwd, "SPEC", orch.specPath));
  }
  entries.push(readEntry(cwd, "ORCHESTRATION", orch.orchestrationPath));
  orch.slices.forEach((slice, idx) => {
    const role = agentTypeToRoleLabel(slice.agentType);
    entries.push(readEntry(cwd, `TASK T${idx + 1} (${role})`, slice.slicePath));
  });

  return entries;
}

function readEntry(cwd: string, label: string, relPath: string): PlanFileEntry {
  const absPath = relPath.startsWith("/") ? relPath : join(cwd, relPath);
  if (!existsSync(absPath)) {
    return { label, path: relPath, content: "", missing: true };
  }
  try {
    return { label, path: relPath, content: readFileSync(absPath, "utf-8") };
  } catch {
    return { label, path: relPath, content: "", missing: true };
  }
}

/**
 * Build the markdown section that gets appended to the plan comment.
 * Returns an empty string when there are no readable entries (caller
 * should skip the section entirely in that case).
 */
export function formatPlanFilesSection(entries: PlanFileEntry[]): string {
  const readable = entries.filter((e) => !e.missing);
  if (readable.length === 0) return "";

  // Per-file budget: divide the soft budget roughly across entries, but
  // give each file a floor (PER_FILE_MIN_CHARS) so a single huge slice
  // can't starve everyone. Files that come in under their share don't
  // give back — we just check the running total when emitting.
  const targetPerFile = Math.max(
    PER_FILE_MIN_CHARS,
    Math.floor(SOFT_BUDGET_CHARS / readable.length),
  );

  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const block = formatEntry(entry, Math.min(targetPerFile, SOFT_BUDGET_CHARS - used));
    blocks.push(block);
    used += block.length;
  }

  return [
    ``,
    `---`,
    ``,
    `### 📂 Plan files`,
    ``,
    `_Click to expand each file. These are the artefacts written to \`.software-teams/plans/\` during this run — review them before approving._`,
    ``,
    ...blocks,
  ].join("\n");
}

function formatEntry(entry: PlanFileEntry, budget: number): string {
  if (entry.missing) {
    return [
      `<details>`,
      `<summary><strong>${escapeHtml(entry.label)}</strong> — <code>${escapeHtml(entry.path)}</code> <em>(could not read)</em></summary>`,
      ``,
      `_File was expected but could not be read from the runner workspace. Plan implementation may fail — investigate before approving._`,
      ``,
      `</details>`,
      ``,
    ].join("\n");
  }

  const { content, wasTruncated, droppedLines } = clampContent(
    entry.content,
    Math.max(PER_FILE_MIN_CHARS, Math.min(PER_FILE_TRUNCATION_TARGET, budget)),
  );

  const lines: string[] = [
    `<details>`,
    `<summary><strong>${escapeHtml(entry.label)}</strong> — <code>${escapeHtml(entry.path)}</code></summary>`,
    ``,
    content,
  ];
  if (wasTruncated) {
    lines.push(``);
    lines.push(`_…truncated (${droppedLines} more lines). Full file lives at \`${entry.path}\` in the action workspace._`);
  }
  lines.push(``);
  lines.push(`</details>`);
  lines.push(``);
  return lines.join("\n");
}

function clampContent(
  raw: string,
  maxChars: number,
): { content: string; wasTruncated: boolean; droppedLines: number } {
  if (raw.length <= maxChars) {
    return { content: raw, wasTruncated: false, droppedLines: 0 };
  }
  // Cut on a line boundary so we don't truncate mid-fence.
  const head = raw.slice(0, maxChars);
  const lastNewline = head.lastIndexOf("\n");
  const keep = lastNewline > 0 ? head.slice(0, lastNewline) : head;
  const remainder = raw.slice(keep.length);
  const droppedLines = remainder.split("\n").length;
  return { content: keep, wasTruncated: true, droppedLines };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
