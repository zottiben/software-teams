import { detectProjectType } from "../detect-project";
import { readAdapter, type AdapterConfig } from "../adapter";
import { loadPersistedState } from "../storage-lifecycle";
import { createStorage } from "../../storage";

export interface PromptContext {
  cwd: string;
  projectType: string;
  techStack: string;
  qualityGates: string;
  rulesPath: string | null;
  codebaseIndexPath: string | null;
  ticketContext?: string;
  conversationHistory?: string;
  adapter: AdapterConfig | null;
}

export async function gatherPromptContext(cwd: string): Promise<PromptContext> {
  const projectType = await detectProjectType(cwd);
  const adapter = await readAdapter(cwd);
  const techStack = adapter?.tech_stack
    ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
    : projectType;
  const qualityGates = adapter?.quality_gates
    ? Object.entries(adapter.quality_gates).map(([name, cmd]) => `${name}: \`${cmd}\``).join(", ")
    : "default";

  const storage = await createStorage(cwd);
  const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

  return {
    cwd,
    projectType,
    techStack,
    qualityGates,
    rulesPath,
    codebaseIndexPath,
    adapter,
  };
}

export function buildProjectContext(ctx: PromptContext): string[] {
  return [
    `## Project Context`,
    `- Type: ${ctx.projectType}`,
    `- Tech stack: ${ctx.techStack}`,
    `- Quality gates: ${ctx.qualityGates}`,
    `- Rules: ${ctx.rulesPath ?? "(none)"}`,
    `- Codebase index: ${ctx.codebaseIndexPath ?? "(none)"}`,
  ];
}

export function buildWorkspaceContext(ctx: PromptContext): string[] {
  const lines = [
    `## Workspace`,
    `- Working directory: ${ctx.cwd}`,
  ];
  if (ctx.ticketContext) {
    lines.push(``, ctx.ticketContext);
  }
  return lines;
}

export function buildAutoCommitBlock(commitType: "feat" | "fix" | "any"): string[] {
  const prefix = commitType === "any" ? `"..."` : `"${commitType}: ..."`;
  return [
    `## Auto-Commit`,
    `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
    `After making changes:`,
    `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
    `2. \`git commit -m ${prefix}\` with a conventional commit message`,
    `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
  ];
}

export function buildRulesBlock(techStack: string): string[] {
  const lower = techStack.toLowerCase();
  const base = ".software-teams/rules";
  const files = [`${base}/general.md`];

  if (/php|laravel/.test(lower)) files.push(`${base}/backend.md`);
  if (/react|typescript|\.ts|frontend|vite/.test(lower)) files.push(`${base}/frontend.md`);
  if (/test|vitest|pest/.test(lower)) files.push(`${base}/testing.md`);
  if (/docker|ci|deploy/.test(lower)) files.push(`${base}/devops.md`);

  return [
    `## Rules`,
    `Read these rules files and follow any conventions found (rules override defaults):`,
    ...files.map((f) => `- ${f}`),
  ];
}
