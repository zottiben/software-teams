import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Constants — all paths are relative to process.cwd() (the consumer project),
// except template reads which use packageRoot.
// ---------------------------------------------------------------------------

const CLAUDE_DIR = ".claude";
const CLAUDE_MD_PATH = join(CLAUDE_DIR, "CLAUDE.md");
const DIRECTIVE_PATH = join(CLAUDE_DIR, "ask-questions.md");
const IMPORT_LINE = "@.claude/ask-questions.md";

// Resolve packageRoot the same way copy-framework.ts does (src/commands/ is
// two levels below the package root).
const oneUp = join(import.meta.dir, "..");
const twoUp = join(import.meta.dir, "..", "..");
const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;

// ---------------------------------------------------------------------------
// on()
// ---------------------------------------------------------------------------

async function on(): Promise<number> {
  // 1. Cold-start setup.
  await mkdir(join(process.cwd(), CLAUDE_DIR), { recursive: true });

  // 2. Write the directive file (overwrite — idempotent; content is
  //    deterministic). Overwriting ensures fixes ship to existing projects
  //    when they toggle off/on after a framework upgrade.
  const directiveSrc = join(packageRoot, "templates", "ask-questions-directive.md");
  const directiveContent = await readFile(directiveSrc, "utf8");
  const absDirective = join(process.cwd(), DIRECTIVE_PATH);
  await mkdir(dirname(absDirective), { recursive: true });
  await writeFile(absDirective, directiveContent, "utf8");

  // 3. Append @import to .claude/CLAUDE.md (idempotent).
  const absClaudeMd = join(process.cwd(), CLAUDE_MD_PATH);
  if (!existsSync(absClaudeMd)) {
    await writeFile(absClaudeMd, IMPORT_LINE + "\n", "utf8");
  } else {
    const content = await readFile(absClaudeMd, "utf8");
    if (!content.includes(IMPORT_LINE)) {
      const separator = content.endsWith("\n") ? "" : "\n";
      await writeFile(absClaudeMd, content + separator + IMPORT_LINE + "\n", "utf8");
    }
    // If IMPORT_LINE is already present, no-op.
  }

  // 4. Report.
  console.log("Ask Clarifying Questions policy: ON");
  console.log(`  directive file written:  ${DIRECTIVE_PATH}`);
  console.log(`  @import line appended:   ${CLAUDE_MD_PATH}`);

  return 0;
}

// ---------------------------------------------------------------------------
// off()
// ---------------------------------------------------------------------------

async function off(): Promise<number> {
  // 1. Remove @import line from .claude/CLAUDE.md (idempotent).
  const absClaudeMd = join(process.cwd(), CLAUDE_MD_PATH);
  if (existsSync(absClaudeMd)) {
    const content = await readFile(absClaudeMd, "utf8");
    const lines = content.split("\n");
    const filtered = lines.filter((line) => line !== IMPORT_LINE);
    const newContent = filtered.join("\n");
    if (newContent.trim().length === 0) {
      await unlink(absClaudeMd);
    } else {
      await writeFile(absClaudeMd, newContent, "utf8");
    }
  }

  // 2. Delete directive file (idempotent).
  const absDirective = join(process.cwd(), DIRECTIVE_PATH);
  if (existsSync(absDirective)) {
    await unlink(absDirective);
  }

  // 3. Report.
  console.log("Ask Clarifying Questions policy: OFF");
  console.log(`  @import line removed:    ${CLAUDE_MD_PATH}`);
  console.log(`  directive file deleted:  ${DIRECTIVE_PATH}`);

  return 0;
}

// ---------------------------------------------------------------------------
// status()
// ---------------------------------------------------------------------------

async function status(): Promise<number> {
  // Check each artefact independently.
  const absDirective = join(process.cwd(), DIRECTIVE_PATH);
  const hasDirective = existsSync(absDirective);

  const absClaudeMd = join(process.cwd(), CLAUDE_MD_PATH);
  const hasImportLine =
    existsSync(absClaudeMd) &&
    (await readFile(absClaudeMd, "utf8")).split("\n").includes(IMPORT_LINE);

  const fmt = (v: boolean) => (v ? "present" : "missing");

  console.log("Ask Clarifying Questions policy status:");
  console.log(`  directive file (${DIRECTIVE_PATH}): ${fmt(hasDirective)}`);
  console.log(`  @import line (${CLAUDE_MD_PATH}):              ${fmt(hasImportLine)}`);

  const trueCount = [hasDirective, hasImportLine].filter(Boolean).length;
  if (trueCount === 2) {
    console.log("→ ON");
  } else if (trueCount === 0) {
    console.log("→ OFF");
  } else {
    // One artefact present, one missing — drift. The majority-converges
    // heuristic from orchestrator-mode doesn't make sense with only two
    // artefacts (1-of-2 is a tie), so recommend toggling on to converge
    // to a known-good state.
    console.log("→ DRIFT — run /st:ask-questions on to converge");
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Exported function (the contract surface for tests and the citty subcommand)
// ---------------------------------------------------------------------------

export async function askQuestions(sub: "on" | "off" | "status"): Promise<number> {
  if (sub === "on") return on();
  if (sub === "off") return off();
  return status();
}

// ---------------------------------------------------------------------------
// citty subcommand definition (used by src/index.ts registration)
// ---------------------------------------------------------------------------

export const askQuestionsCommand = defineCommand({
  meta: {
    name: "ask-questions",
    description: "Toggle the Ask Clarifying Questions policy (on / off / status)",
  },
  args: {
    sub: {
      type: "positional",
      description: "Subcommand: on | off | status",
      required: false,
    },
  },
  async run({ args }) {
    const sub = (args.sub as string | undefined) ?? "";
    if (sub !== "on" && sub !== "off" && sub !== "status") {
      console.error(`Usage: software-teams ask-questions <on | off | status>`);
      process.exit(2);
    }
    process.exit(await askQuestions(sub));
  },
});
