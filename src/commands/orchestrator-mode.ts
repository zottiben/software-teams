import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { mergeHooks, removeHooks, readSettings, writeSettings } from "../utils/settings-merge";

// ---------------------------------------------------------------------------
// Constants — all paths are relative to process.cwd() (the consumer project),
// except template reads which use packageRoot.
// ---------------------------------------------------------------------------

const CLAUDE_DIR = ".claude";
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const CLAUDE_MD_PATH = join(CLAUDE_DIR, "CLAUDE.md");
const DIRECTIVE_PATH = join(CLAUDE_DIR, "orchestrator-mode.md");
const HOOK_SCRIPT_PATH = join(CLAUDE_DIR, "hooks", "orchestrator-deny-bash.sh");
const IMPORT_LINE = "@.claude/orchestrator-mode.md";
const HOOK_MATCHER = "Edit|Write|NotebookEdit|Bash";
const HOOK_COMMAND_VALUE = ".claude/hooks/orchestrator-deny-bash.sh";

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
  const absSettings = join(process.cwd(), SETTINGS_PATH);
  if (!existsSync(absSettings)) {
    await writeFile(absSettings, "{}\n", "utf8");
  }

  // 2. Write the directive file (overwrite — idempotent; content is deterministic).
  const directiveSrc = join(packageRoot, "templates", "orchestrator-mode-directive.md");
  const directiveContent = await readFile(directiveSrc, "utf8");
  const absDirective = join(process.cwd(), DIRECTIVE_PATH);
  await mkdir(dirname(absDirective), { recursive: true });
  await writeFile(absDirective, directiveContent, "utf8");

  // 3. Ensure the hook script exists at .claude/hooks/orchestrator-deny-bash.sh.
  const absHookScript = join(process.cwd(), HOOK_SCRIPT_PATH);
  if (!existsSync(absHookScript)) {
    const hookSrc = join(packageRoot, "templates", ".claude", "hooks", "orchestrator-deny-bash.sh");
    const hookContent = await readFile(hookSrc, "utf8");
    await mkdir(dirname(absHookScript), { recursive: true });
    await writeFile(absHookScript, hookContent, "utf8");
    await chmod(absHookScript, 0o755);
  }

  // 4. Append @import to .claude/CLAUDE.md (idempotent).
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

  // 5. Merge hook entry into settings.json.
  const settings = await readSettings(absSettings);
  const next = mergeHooks(settings, [
    { event: "PreToolUse", matcher: HOOK_MATCHER, command: HOOK_COMMAND_VALUE },
  ]);
  await writeSettings(absSettings, next);

  // 6. Report.
  console.log("Orchestrator-Only Mode: ON");
  console.log(`  directive file written:  ${DIRECTIVE_PATH}`);
  console.log(`  @import line appended:   ${CLAUDE_MD_PATH}`);
  console.log(`  hook entry merged:       ${SETTINGS_PATH}`);

  return 0;
}

// ---------------------------------------------------------------------------
// off()
// ---------------------------------------------------------------------------

async function off(): Promise<number> {
  // 1. Remove hook entry from settings.json (idempotent).
  const absSettings = join(process.cwd(), SETTINGS_PATH);
  if (existsSync(absSettings)) {
    const settings = await readSettings(absSettings);
    const next = removeHooks(settings, [
      { event: "PreToolUse", matcher: HOOK_MATCHER, command: HOOK_COMMAND_VALUE },
    ]);
    await writeSettings(absSettings, next);
  }

  // 2. Remove @import line from .claude/CLAUDE.md (idempotent).
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

  // 3. Delete directive file (idempotent).
  const absDirective = join(process.cwd(), DIRECTIVE_PATH);
  if (existsSync(absDirective)) {
    await unlink(absDirective);
  }

  // 4. Do NOT delete .claude/hooks/orchestrator-deny-bash.sh — template asset.

  // 5. Report.
  console.log("Orchestrator-Only Mode: OFF");
  console.log(`  hook entry removed:      ${SETTINGS_PATH}`);
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

  const absSettings = join(process.cwd(), SETTINGS_PATH);
  let hasHookEntry = false;
  if (existsSync(absSettings)) {
    const settings = await readSettings(absSettings);
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    hasHookEntry = preToolUse.some(
      (entry) =>
        entry.matcher === HOOK_MATCHER &&
        entry.hooks.some((h) => h.command === HOOK_COMMAND_VALUE),
    );
  }

  const fmt = (v: boolean) => (v ? "present" : "missing");

  console.log("Orchestrator-Only Mode status:");
  console.log(`  directive file (${DIRECTIVE_PATH}): ${fmt(hasDirective)}`);
  console.log(`  @import line (${CLAUDE_MD_PATH}):              ${fmt(hasImportLine)}`);
  console.log(`  hook entry (${SETTINGS_PATH}):            ${fmt(hasHookEntry)}`);

  const trueCount = [hasDirective, hasImportLine, hasHookEntry].filter(Boolean).length;
  if (trueCount === 3) {
    console.log("→ ON");
  } else if (trueCount === 0) {
    console.log("→ OFF");
  } else {
    const majority = trueCount >= 2 ? "off" : "on";
    console.log(
      `→ DRIFT — run /st:orchestrator-mode ${majority} to converge`,
    );
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Exported function (the contract surface for T5 and T9)
// ---------------------------------------------------------------------------

export async function orchestratorMode(sub: "on" | "off" | "status"): Promise<number> {
  if (sub === "on") return on();
  if (sub === "off") return off();
  return status();
}

// ---------------------------------------------------------------------------
// citty subcommand definition (used by src/index.ts registration)
// ---------------------------------------------------------------------------

export const orchestratorModeCommand = defineCommand({
  meta: {
    name: "orchestrator-mode",
    description: "Toggle Orchestrator-Only Mode (on / off / status)",
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
      console.error(`Usage: software-teams orchestrator-mode <on | off | status>`);
      process.exit(2);
    }
    process.exit(await orchestratorMode(sub));
  },
});
