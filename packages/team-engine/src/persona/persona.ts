import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A persona loaded from a canonical Software Teams agent spec. */
export interface PersonaFile {
  /** Agent identity, e.g. `software-teams-frontend`. */
  readonly name: string;
  /** Preferred model from frontmatter (e.g. `sonnet`), if declared. */
  readonly model?: string;
  readonly description?: string;
  /** System-prompt body with YAML frontmatter stripped. */
  readonly persona: string;
}

/** One slot in a live team: a short role label bound to a canonical agent spec. */
export interface RosterSlot {
  readonly role: string;
  readonly agent: string;
}

/**
 * The default team the user asked for: an orchestrator in the main pane plus these
 * specialists, each in its own pane. Roles are the short labels; `agent` names the
 * canonical persona file under the CLI package's `agents/` directory.
 */
export const DEFAULT_TEAM: readonly RosterSlot[] = [
  { role: 'frontend', agent: 'software-teams-frontend' },
  { role: 'backend', agent: 'software-teams-backend' },
  { role: 'qa', agent: 'software-teams-qa-tester' },
  { role: 'devops', agent: 'software-teams-devops' },
  { role: 'architect', agent: 'software-teams-architect' },
  { role: 'planner', agent: 'software-teams-planner' },
  { role: 'researcher', agent: 'software-teams-researcher' },
  { role: 'ux', agent: 'software-teams-ux-designer' },
];

function findCliAgentsDir(start: string): string {
  const visit = (dir: string): string | undefined => {
    const candidate = join(dir, 'packages', 'cli', 'agents');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    return parent === dir ? undefined : visit(parent);
  };
  const found = visit(start);
  if (!found) {
    throw new Error(
      'Could not locate packages/cli/agents (Software Teams personas). Set ST_AGENTS_DIR to override.',
    );
  }
  return found;
}

/**
 * Resolve the directory of canonical persona files. Honours `ST_AGENTS_DIR`, else
 * walks up from this module to the monorepo's `packages/cli/agents`. (Packaged
 * builds will bundle the personas and pass the dir explicitly — Phase 4.)
 */
export function defaultAgentsDir(): string {
  const override = process.env.ST_AGENTS_DIR;
  if (override && existsSync(override)) return override;
  return findCliAgentsDir(dirname(fileURLToPath(import.meta.url)));
}

function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const firstNewline = raw.indexOf('\n');
  const closing = raw.indexOf('\n---', firstNewline);
  if (firstNewline === -1 || closing === -1) return { meta: {}, body: raw };
  const block = raw.slice(firstNewline + 1, closing);
  const body = raw.slice(closing + 4).replace(/^[\r\n]+/, '');
  const meta = block.split('\n').reduce<Record<string, string>>((acc, line) => {
    // top-level `key: value` only — skip list items and nested entries
    const match = /^([A-Za-z][\w-]*):\s*(.+)$/.exec(line);
    if (match && match[1] && match[2] !== undefined) acc[match[1]] = match[2].trim();
    return acc;
  }, {});
  return { meta, body };
}

/** Load and parse a single canonical persona by agent name. */
export function loadPersona(agent: string, agentsDir: string = defaultAgentsDir()): PersonaFile {
  const file = join(agentsDir, `${agent}.md`);
  const raw = readFileSync(file, 'utf8');
  const { meta, body } = splitFrontmatter(raw);
  return {
    name: meta.name ?? agent,
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    persona: body.trim(),
  };
}
