import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

function resolveAgentSpecPath(cwd: string, agentName: string): string | null {
  const claudeNative = join(cwd, ".claude", "agents", `${agentName}.md`);
  if (existsSync(claudeNative)) return claudeNative;
  const selfHost = join(cwd, "agents", `${agentName}.md`);
  if (existsSync(selfHost)) return selfHost;
  // Package-root fallback (mirrors copy-framework.ts and convert-agents.ts).
  const oneUp = join(import.meta.dir, "..");
  const twoUp = join(import.meta.dir, "..", "..");
  const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;
  const pkgPath = join(packageRoot, "agents", `${agentName}.md`);
  if (existsSync(pkgPath)) return pkgPath;
  return null;
}

function stripSpecFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const rawBody = fmMatch ? content.slice(fmMatch[0].length) : content;
  return rawBody
    .replace(/^\s*<!--\s*AUTO-GENERATED[\s\S]*?-->\s*\n?/, "")
    .replace(/^\s*<!--\s*canonical frontmatter[\s\S]*?-->\s*\n?/, "")
    .trim();
}

// Module-load cache. Spec body is read once per process — subsequent calls
// return the cached string. The cache lives for the process lifetime; this
// matches the lifecycle of the CLI command (one process per invocation) and
// of the long-running action runner (one process across many spawns).
const _agentSpecCache = new Map<string, string | null>();

export function readAgentSpecBody(cwd: string, agentName: string): string | null {
  const cacheKey = `${cwd}:${agentName}`;
  if (_agentSpecCache.has(cacheKey)) return _agentSpecCache.get(cacheKey) ?? null;

  const path = resolveAgentSpecPath(cwd, agentName);
  if (path == null) {
    _agentSpecCache.set(cacheKey, null);
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    const body = stripSpecFrontmatter(content);
    _agentSpecCache.set(cacheKey, body);
    return body;
  } catch {
    _agentSpecCache.set(cacheKey, null);
    return null;
  }
}

export function resetAgentSpecCache(): void {
  _agentSpecCache.clear();
}

export function inlineAgentSpec(cwd: string, agentName: string, fallbackPath: string): string[] {
  const body = readAgentSpecBody(cwd, agentName);
  if (body == null) {
    return [
      `## Agent Spec — ${agentName}`,
      `Spec file: ${fallbackPath}`,
      `(Read the spec file before proceeding — it could not be inlined into this prompt.)`,
    ];
  }
  return [
    `## Agent Spec — ${agentName}`,
    body,
  ];
}

