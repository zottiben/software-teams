import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { TagRef, ComponentResolution, ScenarioResult } from "./types";

const REPO_ROOT = process.cwd();

// Approximate tokens-per-char for English Markdown. Anthropic's tokenizer is
// closer to 1 token per ~3.7 chars; rounded conservatively to 4. The exact
// constant doesn't change relative comparisons.
const CHARS_PER_TOKEN = 4;

// Per-tool-call wrapper overhead (request schema + response wrapper). Rough
// estimate; tune later when we measure against real spawns.
const TOOL_CALL_OVERHEAD_TOKENS = 200;

const COMPONENT_DIRS = [
  "framework/components/meta",
  "framework/components/execution",
  "framework/components/planning",
  "framework/components/quality",
];

export { REPO_ROOT, CHARS_PER_TOKEN, TOOL_CALL_OVERHEAD_TOKENS };

export function tokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

export function findComponentFile(name: string): string | null {
  for (const dir of COMPONENT_DIRS) {
    const candidate = join(REPO_ROOT, dir, `${name}.md`);
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      // Not in this dir, try the next.
    }
  }
  return null;
}

export function resolveHostPath(sourceRelPath: string): string {
  if (sourceRelPath.startsWith("framework/agents/")) {
    const filename = sourceRelPath.replace("framework/agents/", "");
    const resolved = join(REPO_ROOT, ".claude", "agents", filename);
    if (existsSync(resolved)) return resolved;
  }
  if (sourceRelPath.startsWith("framework/commands/")) {
    const filename = sourceRelPath.replace("framework/commands/", "");
    const resolved = join(REPO_ROOT, ".claude", "commands", "st", filename);
    if (existsSync(resolved)) return resolved;
  }
  // Fallback: use the source path (logs a warning below).
  console.warn(`  [warn] No resolved counterpart for ${sourceRelPath}; using source file.`);
  return join(REPO_ROOT, sourceRelPath);
}

export function parseTags(host: string): TagRef[] {
  // Match `@ST:Name` and `@ST:Name:Section`.
  const re = /@ST:([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z][A-Za-z0-9-]*))?/g;
  const tags: TagRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(host)) !== null) {
    tags.push({ name: match[1], section: match[2], raw: match[0] });
  }
  return tags;
}

export function extractSection(content: string, sectionName: string): string | null {
  // Strategy 1 — explicit HTML section block, case-insensitive name match.
  const htmlRe = new RegExp(
    `<section\\s+name="${sectionName}"[^>]*>([\\s\\S]*?)</section>`,
    "i",
  );
  const htmlMatch = content.match(htmlRe);
  if (htmlMatch) return htmlMatch[1].trim();

  // Strategy 2 — Markdown heading boundary (## or ###). Section name is a
  // case-insensitive substring of the heading text.
  const lines = content.split("\n");
  let startIdx = -1;
  let startDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
    if (!headingMatch) continue;
    const depth = headingMatch[1].length;
    const text = headingMatch[2].toLowerCase();
    if (text.includes(sectionName.toLowerCase())) {
      startIdx = i;
      startDepth = depth;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{2,6})\s+/);
    if (headingMatch && headingMatch[1].length <= startDepth) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

export function estimateNaturalSectionSize(content: string): number {
  const lines = content.split("\n");
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) boundaries.push(i);
  }
  if (boundaries.length === 0) return content.length;
  boundaries.push(lines.length);
  let totalSectionBytes = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const slice = lines.slice(boundaries[i], boundaries[i + 1]).join("\n");
    totalSectionBytes += slice.length;
  }
  return Math.ceil(totalSectionBytes / (boundaries.length - 1));
}

export function resolveTag(tag: TagRef): ComponentResolution {
  const filePath = findComponentFile(tag.name);
  if (!filePath) {
    return {
      tag,
      filePath: `<missing>:${tag.name}`,
      exists: false,
      fullBytes: 0,
      sectionBytes: 0,
    };
  }

  const content = readFileSync(filePath, "utf-8");
  const fullBytes = content.length;

  let sectionBytes = fullBytes;
  if (tag.section) {
    const section = extractSection(content, tag.section);
    sectionBytes = section ? section.length : 0; // 0 = section not found (broken ref)
  }

  return {
    tag,
    filePath,
    exists: true,
    fullBytes,
    sectionBytes,
  };
}

export { basename };
