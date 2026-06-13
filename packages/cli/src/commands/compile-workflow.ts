import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseOrchestration } from "../utils/parse-orchestration";
import { buildWorkflowScript } from "../utils/compile-workflow";

const PLANS_DIR = ".software-teams/plans";

/**
 * Resolve which `*.orchestration.md` to compile.
 *  - explicit path ending in `.orchestration.md`           → use as-is
 *  - a slug                                                 → {PLANS_DIR}/{slug}.orchestration.md
 *  - nothing → the single orchestration plan, or the most recently modified
 *    one when several exist (reported), or an error when none exist.
 */
async function resolveOrchestrationPath(
  cwd: string,
  arg: string | undefined,
): Promise<string> {
  if (arg && arg.endsWith(".orchestration.md")) {
    const abs = arg.startsWith("/") ? arg : join(cwd, arg);
    if (!existsSync(abs)) throw new Error(`Orchestration file not found: ${arg}`);
    return abs;
  }
  if (arg) {
    const abs = join(cwd, PLANS_DIR, `${arg}.orchestration.md`);
    if (!existsSync(abs)) {
      throw new Error(`No orchestration plan for slug '${arg}' at ${PLANS_DIR}/${arg}.orchestration.md`);
    }
    return abs;
  }

  const dir = join(cwd, PLANS_DIR);
  if (!existsSync(dir)) {
    throw new Error(`No plans directory (${PLANS_DIR}). Run \`software-teams plan\` first.`);
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith(".orchestration.md"));
  if (files.length === 0) {
    throw new Error(`No *.orchestration.md plans found in ${PLANS_DIR}. compile-workflow needs a three-tier orchestration plan.`);
  }
  const [first] = files;
  if (files.length === 1 && first) return join(dir, first);

  // Multiple: pick the most recently modified and say so.
  const withMtime = await Promise.all(
    files.map(async (f) => ({ f, m: (await stat(join(dir, f))).mtimeMs })),
  );
  withMtime.sort((a, b) => b.m - a.m);
  const chosen = withMtime[0]?.f;
  if (!chosen) {
    throw new Error(`No orchestration plan resolvable in ${PLANS_DIR}`);
  }
  consola.info(
    `Multiple orchestration plans found; using the most recent: ${chosen}. ` +
      `Pass a slug to choose explicitly.`,
  );
  return join(dir, chosen);
}

export async function compileWorkflow(
  cwd: string,
  opts: { plan?: string; qa?: boolean; output?: string; print?: boolean },
): Promise<number> {
  const orchestrationPath = await resolveOrchestrationPath(cwd, opts.plan);
  const parsed = await parseOrchestration(orchestrationPath);
  const script = buildWorkflowScript(parsed, { qa: opts.qa });

  if (opts.print) {
    process.stdout.write(script);
    return 0;
  }

  const outPath = opts.output
    ? (opts.output.startsWith("/") ? opts.output : join(cwd, opts.output))
    : join(cwd, PLANS_DIR, `${parsed.slug}.workflow.js`);
  await writeFile(outPath, script, "utf8");

  const rel = outPath.startsWith(cwd + "/") ? outPath.slice(cwd.length + 1) : outPath;
  consola.success(`Compiled workflow → ${rel}`);
  consola.info(
    `${parsed.tasks.length} task(s) across ${new Set(parsed.tasks.map((t) => t.wave)).size} wave(s).`,
  );
  consola.info(
    `Run it deterministically via the Claude Code Workflow tool (opt-in): ask Claude to "run the workflow at ${rel}", or mention "ultracode". ` +
      `Without opt-in, implement-plan still runs the plan wave-by-wave as before.`,
  );
  return 0;
}

export const compileWorkflowCommand = defineCommand({
  meta: {
    name: "compile-workflow",
    description:
      "Compile a three-tier orchestration plan into a deterministic Claude Code Workflow script",
  },
  args: {
    plan: {
      type: "positional",
      description: "Plan slug or path to a *.orchestration.md (auto-detected if omitted)",
      required: false,
    },
    qa: {
      type: "boolean",
      description: "Append a final QA-tester verification phase (use --no-qa to skip)",
      default: true,
    },
    output: {
      type: "string",
      description: `Output path (default: ${PLANS_DIR}/{slug}.workflow.js)`,
    },
    print: {
      type: "boolean",
      description: "Print the script to stdout instead of writing a file",
      default: false,
    },
  },
  async run({ args }) {
    try {
      const code = await compileWorkflow(process.cwd(), {
        plan: args.plan as string | undefined,
        qa: args.qa as boolean,
        output: args.output as string | undefined,
        print: Boolean(args.print),
      });
      process.exit(code);
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
