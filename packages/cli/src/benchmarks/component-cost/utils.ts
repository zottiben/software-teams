import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { TagRef, ComponentResolution } from "./types";

const REPO_ROOT = process.cwd();
const CHARS_PER_TOKEN = 4;
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
      // continue
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
  console.warn(`  [warn] No resolved counterpart for ${sourceRelPath}; using source file.`);
  return join(REPO_ROOT, sourceRelPath);
}

export function parseTags(host: string): TagRef[] {
  const re = /@ST:([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z][A-Za-z0-9-]*))?/g;
  return Array.from(
    host.matchAll(re),
    (match) => ({ name: match[1], section: match[2], raw: match[0] }),
  );
}

export function extractSection(content: string, sectionName: string): string | null {
  const htmlRe = new RegExp(
    `<section\\s+name="${sectionName}"[^>]*>([\\s\\S]*?)</section>`,
    "i",
  );
  const htmlMatch = content.match(htmlRe);
  if (htmlMatch) return htmlMatch[1].trim();

  const lines = content.split("\n");
  const startEntry = lines.reduce<{ idx: number; depth: number } | null>((found, line, i) => {
    if (found !== null) return found;
    const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
    if (!headingMatch) return null;
    const depth = headingMatch[1].length;
    const text = headingMatch[2].toLowerCase();
    return text.includes(sectionName.toLowerCase()) ? { idx: i, depth } : null;
  }, null);
  if (startEntry === null) return null;

  const { idx: startIdx, depth: startDepth } = startEntry;
  const endIdx = lines.findIndex(
    (line, i) => i > startIdx && /^(#{2,6})\s+/.test(line) && ((line.match(/^(#{2,6})/)?.[1]?.length ?? 0) <= startDepth),
  );
  return lines.slice(startIdx, endIdx < 0 ? lines.length : endIdx).join("\n").trim();
}

export function estimateNaturalSectionSize(content: string): number {
  const lines = content.split("\n");
  const boundaries = lines.reduce<number[]>(
    (acc, line, i) => (/^##\s+/.test(line) ? [...acc, i] : acc),
    [],
  );
  if (boundaries.length === 0) return content.length;
  const allBoundaries = [...boundaries, lines.length];
  const totalSectionBytes = allBoundaries.slice(0, -1).reduce(
    (sum, start, i) => sum + lines.slice(start, allBoundaries[i + 1]).join("\n").length,
    0,
  );
  return Math.ceil(totalSectionBytes / (allBoundaries.length - 1));
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

  const resolvedSection = tag.section ? extractSection(content, tag.section) : null;
  const sectionBytes = tag.section
    ? (resolvedSection ? resolvedSection.length : 0)
    : fullBytes;

  return {
    tag,
    filePath,
    exists: true,
    fullBytes,
    sectionBytes,
  };
}

export { basename };
