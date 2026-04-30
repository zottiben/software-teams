/**
 * build-plugin.ts — deterministic generator for the Software Teams Claude Code
 * plugin content tree.
 *
 * Reads `framework/agents/software-teams-*.md` and `framework/commands/*.md`
 * and writes the plugin's `agents/` and `commands/` trees at the repo root.
 *
 * The generator is pure and idempotent: running it twice against identical
 * inputs produces byte-identical outputs (zero git diff).
 */

import { join, relative, basename } from "path";
import { existsSync, mkdirSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ─── Shared types ────────────────────────────────────────────────────────────

export interface BuildPluginOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** When true, no files are written — logs what would be produced. */
  dryRun?: boolean;
}

export interface BuildPluginResult {
  agentsWritten: string[];
  commandsWritten: string[];
  errors: { file: string; reason: string }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_BANNER =
  "<!-- AUTO-GENERATED — do not hand-edit; run `software-teams build-plugin` -->";
const COMMAND_BANNER =
  "<!-- AUTO-GENERATED — do not hand-edit; run `software-teams build-plugin` -->";

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseMarkdownFile(content: string, filePath: string): ParsedFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(
      `build-plugin: ${filePath} is missing YAML frontmatter (expected leading '---' block)`,
    );
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `build-plugin: failed to parse frontmatter in ${filePath}: ${reason}`,
    );
  }
  return { frontmatter, body: match[2] ?? "" };
}

// ─── Agent generator ─────────────────────────────────────────────────────────

/**
 * Render a single framework agent file to its plugin-distribution form.
 *
 * Applies the same transform as `convert-agents.ts`:
 *  - Keeps only name/description/model/tools in frontmatter
 *  - Sorts tools alphabetically (stable ordering)
 *  - Prepends an AUTO-GENERATED banner
 *  - Appends a "Software Teams source:" footer
 *
 * Output is byte-stable for a given input.
 */
function renderAgentFile(
  parsed: ParsedFile,
  relSourcePath: string,
): string {
  const fm = parsed.frontmatter;

  // Validate required fields
  const name = fm.name;
  const description = fm.description;
  const model = fm.model;
  const tools = fm.tools;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof description !== "string" || !description.trim() ||
    typeof model !== "string" || !model.trim() ||
    !Array.isArray(tools) || tools.length === 0
  ) {
    throw new Error(
      `build-plugin: ${relSourcePath} is missing required frontmatter fields (name, description, model, tools)`,
    );
  }

  const outFm = {
    name: name as string,
    description: description as string,
    model: model as string,
    tools: [...(tools as string[])].sort((a, b) => a.localeCompare(b)),
  };

  const yamlBody = stringifyYaml(outFm, { lineWidth: 0 }).trimEnd();
  const body = parsed.body.replace(/^\s+/, "").replace(/\s+$/, "");
  const footer = `Software Teams source: ${relSourcePath}`;

  return [
    "---",
    yamlBody,
    "---",
    "",
    AGENT_BANNER,
    "",
    body,
    "",
    footer,
    "",
  ].join("\n");
}

/**
 * Build the `agents/` directory at repo root from `framework/agents/software-teams-*.md`.
 *
 * @param frameworkAgentsDir  Absolute path to `framework/agents/`
 * @param outDir              Absolute path to target `agents/` directory
 * @param repoRoot            Repo root (used for relative source paths in footers)
 * @param dryRun              When true, skip writes
 */
export async function buildPluginAgents(
  frameworkAgentsDir: string,
  outDir: string,
  repoRoot: string,
  dryRun: boolean,
  result: BuildPluginResult,
): Promise<void> {
  if (!existsSync(frameworkAgentsDir)) {
    result.errors.push({
      file: frameworkAgentsDir,
      reason: `source directory not found: ${frameworkAgentsDir}`,
    });
    return;
  }

  const glob = new Bun.Glob("software-teams-*.md");
  const sourceFiles: string[] = [];
  for await (const file of glob.scan({ cwd: frameworkAgentsDir })) {
    sourceFiles.push(file);
  }
  // Deterministic ordering
  sourceFiles.sort();

  if (!dryRun && !existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  for (const file of sourceFiles) {
    const sourcePath = join(frameworkAgentsDir, file);
    try {
      const content = await Bun.file(sourcePath).text();
      const parsed = parseMarkdownFile(content, sourcePath);
      const relSource = relative(repoRoot, sourcePath) || basename(sourcePath);
      const rendered = renderAgentFile(parsed, relSource);

      const outPath = join(outDir, file);
      if (!dryRun) {
        await Bun.write(outPath, rendered);
      }
      result.agentsWritten.push(outPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: sourcePath, reason });
    }
  }
}

// ─── Command generator ────────────────────────────────────────────────────────

/**
 * Render a single framework command file to its plugin-distribution form.
 *
 * Commands are near-pass-through: we prepend an AUTO-GENERATED banner and
 * preserve the original content exactly. Frontmatter is preserved verbatim
 * so the plugin loader can read it.
 */
function renderCommandFile(
  content: string,
  _relSourcePath: string,
): string {
  // Content is preserved as-is; we prepend the banner after the frontmatter
  // block so the YAML frontmatter remains first.
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    // No frontmatter — prepend banner directly
    const trimmed = content.replace(/^\s+/, "").replace(/\s+$/, "");
    return `${COMMAND_BANNER}\n\n${trimmed}\n`;
  }

  const body = (match[2] ?? "").replace(/^\s+/, "").replace(/\s+$/, "");

  return [
    "---",
    match[1].trimEnd(),
    "---",
    "",
    COMMAND_BANNER,
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Build the `commands/` directory at repo root from `framework/commands/*.md`.
 *
 * @param frameworkCommandsDir  Absolute path to `framework/commands/`
 * @param outDir                Absolute path to target `commands/` directory
 * @param repoRoot              Repo root (for relative path reporting)
 * @param dryRun                When true, skip writes
 */
export async function buildPluginCommands(
  frameworkCommandsDir: string,
  outDir: string,
  repoRoot: string,
  dryRun: boolean,
  result: BuildPluginResult,
): Promise<void> {
  if (!existsSync(frameworkCommandsDir)) {
    result.errors.push({
      file: frameworkCommandsDir,
      reason: `source directory not found: ${frameworkCommandsDir}`,
    });
    return;
  }

  const glob = new Bun.Glob("*.md");
  const sourceFiles: string[] = [];
  for await (const file of glob.scan({ cwd: frameworkCommandsDir })) {
    sourceFiles.push(file);
  }
  // Deterministic ordering
  sourceFiles.sort();

  if (!dryRun && !existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  for (const file of sourceFiles) {
    const sourcePath = join(frameworkCommandsDir, file);
    try {
      const content = await Bun.file(sourcePath).text();
      const relSource = relative(repoRoot, sourcePath) || basename(sourcePath);
      const rendered = renderCommandFile(content, relSource);

      const outPath = join(outDir, file);
      if (!dryRun) {
        await Bun.write(outPath, rendered);
      }
      result.commandsWritten.push(outPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: sourcePath, reason });
    }
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Generate the plugin's `agents/` and `commands/` content trees from `framework/`.
 *
 * Idempotent — running twice with the same inputs produces zero diffs.
 */
export async function buildPlugin(
  opts: BuildPluginOptions = {},
): Promise<BuildPluginResult> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const dryRun = opts.dryRun === true;

  const result: BuildPluginResult = {
    agentsWritten: [],
    commandsWritten: [],
    errors: [],
  };

  const frameworkAgentsDir = join(repoRoot, "framework", "agents");
  const frameworkCommandsDir = join(repoRoot, "framework", "commands");
  const outAgentsDir = join(repoRoot, "agents");
  const outCommandsDir = join(repoRoot, "commands");

  await buildPluginAgents(frameworkAgentsDir, outAgentsDir, repoRoot, dryRun, result);
  await buildPluginCommands(frameworkCommandsDir, outCommandsDir, repoRoot, dryRun, result);

  return result;
}
