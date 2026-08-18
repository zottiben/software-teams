import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedApi = require("@websitelabs/software-teams") as {
  withStructuredOutput: (tools: readonly string[]) => string[];
  SINGLE_TURN_DISALLOWED_TOOLS: readonly string[];
  STE_RESPONSE_STYLE: string;
};

/**
 * A Claude Code subagent definition, in the shape the `--agents` flag accepts.
 * Field names match subagent frontmatter exactly.
 */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  effort?: string;
  maxTurns?: number;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Read the `key: value` scalars and `- item` sequences out of a spec's
 * frontmatter.
 *
 * Deliberately not a full YAML parse: this runs on the n8n worker for every
 * turn, and a malformed spec should degrade to "no metadata" rather than throw
 * mid-execution.
 */
export function parseSpecFrontmatter(source: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(source);
  if (!match?.[1]) return { meta: {}, body: source.trim() };

  const meta: Record<string, string | string[]> = {};
  const state = { key: "", list: [] as string[] };

  const flush = (): void => {
    if (state.key && state.list.length > 0) meta[state.key] = [...state.list];
    state.list = [];
  };

  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)?.[1];
    if (item !== undefined && state.key) {
      state.list.push(item.trim());
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const key = pair?.[1];
    const value = pair?.[2];
    if (key === undefined || value === undefined) continue;
    flush();
    state.key = key;
    if (value.trim()) meta[key] = value.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  flush();

  return { meta, body: (match[2] ?? "").trim() };
}

/** Strip the generator banners so they do not reach the model as instructions. */
function stripBanners(body: string): string {
  return body
    .replace(/^\s*<!--\s*AUTO-GENERATED[\s\S]*?-->\s*\n?/, "")
    .replace(/^\s*<!--\s*canonical frontmatter[\s\S]*?-->\s*\n?/, "")
    .trim();
}

const RULE_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function ruleCategories(agentId: string): string[] {
  const categories = ["general"];
  if (/backend/.test(agentId)) categories.push("backend");
  if (/frontend|ux-designer/.test(agentId)) categories.push("frontend");
  if (/quality|qa|verifier/.test(agentId)) categories.push("testing");
  if (/devops/.test(agentId)) categories.push("devops");
  return categories;
}

/**
 * n8n disables project setting sources for deterministic workers, so native
 * Claude rules cannot auto-load there. Inject the relevant rule bodies into
 * the agent's system prompt while preserving the same source files as the CLI.
 */
export function loadNativeRuleContext(agentId: string, baseDir: string): string {
  const ruleDirs = [
    join(baseDir, ".claude", "rules"),
    join(__dirname, "..", "..", "rules"),
    join(__dirname, "..", "..", "dist", "rules"),
  ].filter(existsSync);
  if (ruleDirs.length === 0) return "";

  const files = ["software-teams", ...ruleCategories(agentId)]
    .filter((category, index, all) => all.indexOf(category) === index)
    .map((category) => `${category}.md`);
  const sections = files.flatMap((file) => {
    const path = ruleDirs.map((dir) => join(dir, file)).find(existsSync);
    if (!path) return [];
    try {
      const body = readFileSync(path, "utf8")
        .replace(RULE_FRONTMATTER_RE, "")
        .trim();
      return body ? [`### ${file}\n\n${body}`] : [];
    } catch {
      return [];
    }
  });
  return sections.length > 0 ? `## Native project rules\n\n${sections.join("\n\n")}` : "";
}

/**
 * Locate a specialist spec.
 *
 * Ordered most- to least-specific: a spec the host project has synced into
 * `.claude/agents/` wins over the copy bundled with the node package, so a
 * project that has customised a specialist gets its own version.
 */
export function resolveAgentSpecPath(agentId: string, baseDir: string): string | null {
  const candidates = [
    join(baseDir, ".claude", "agents", `${agentId}.md`),
    join(__dirname, "..", "..", "agents", `${agentId}.md`),
    join(__dirname, "..", "..", "dist", "agents", `${agentId}.md`),
  ];
  return candidates.find(existsSync) ?? null;
}

/**
 * Build the `--agents` definition for a specialist.
 *
 * This replaces the previous approach of stripping a spec's frontmatter and
 * concatenating its body onto the user prompt. Passing a real definition means
 * the body becomes the agent's SYSTEM prompt rather than user-turn text, and
 * the spec's `tools`, `model`, and `effort` are honoured by the harness instead
 * of being silently discarded.
 *
 * `overrides` win over the spec, so a node parameter still beats the file.
 *
 * Returns `null` when no spec is found, letting the caller run without a
 * pinned identity rather than failing the turn.
 */
export function buildAgentDefinition(opts: {
  readonly agentId: string;
  readonly baseDir: string;
  readonly structuredOutput: boolean;
  readonly overrides?: {
    model?: string;
    effort?: string;
    maxTurns?: number;
    /** Concrete node policy. When present it replaces, rather than widens, the spec tools. */
    tools?: readonly string[];
  };
}): AgentDefinition | null {
  const specPath = resolveAgentSpecPath(opts.agentId, opts.baseDir);
  if (!specPath) return null;

  const source = ((): string => {
    try {
      return readFileSync(specPath, "utf8");
    } catch {
      return "";
    }
  })();
  if (!source) return null;

  const { meta, body } = parseSpecFrontmatter(source);
  const agentPrompt = stripBanners(body);
  if (!agentPrompt) return null;
  const ruleContext = loadNativeRuleContext(opts.agentId, opts.baseDir);
  // n8n bundles the RAW specs, not the plugin's rendered copies, so the style
  // has to be appended here too. Last, after the rules, because a trailing
  // instruction is the one a model is most likely to hold onto.
  const prompt = [agentPrompt, ruleContext, sharedApi.STE_RESPONSE_STYLE]
    .filter(Boolean)
    .join("\n\n");

  const definition: AgentDefinition = {
    description: typeof meta["description"] === "string" ? meta["description"] : opts.agentId,
    prompt,
  };

  const selectedTools = opts.overrides?.tools ?? meta["tools"];
  if (Array.isArray(selectedTools)) {
    // A restricted tool list silently disables --json-schema unless the
    // structured-output tool is granted alongside it. See
    // STRUCTURED_OUTPUT_TOOL in the shared surface. An empty override is
    // meaningful: StructuredOutput becomes the only available tool.
    definition.tools = opts.structuredOutput
      ? sharedApi.withStructuredOutput(selectedTools)
      : [...selectedTools];
  }

  // Each node is one turn of one specialist; nested spawning belongs on the
  // n8n canvas, not inside a node.
  definition.disallowedTools = [...sharedApi.SINGLE_TURN_DISALLOWED_TOOLS];

  const model = opts.overrides?.model ?? (typeof meta["model"] === "string" ? meta["model"] : undefined);
  if (model) definition.model = model;

  const effort =
    opts.overrides?.effort ?? (typeof meta["effort"] === "string" ? meta["effort"] : undefined);
  if (effort) definition.effort = effort;

  if (opts.overrides?.maxTurns !== undefined) definition.maxTurns = opts.overrides.maxTurns;

  return definition;
}
