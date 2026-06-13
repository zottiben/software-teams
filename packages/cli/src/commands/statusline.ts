import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { readSettings, writeSettings } from "../utils/settings-merge";

// ---------------------------------------------------------------------------
// `software-teams statusline` — install / remove the Software Teams statusline.
//
// The renderer is a stdlib-only Python script shipped in the package template.
// This command copies it into the project and wires `.claude/settings.local.json`
// (local + gitignored — a personal display preference, not committed) to point
// at it. It never clobbers an unrelated statusLine without --force.
// ---------------------------------------------------------------------------

const SCRIPT_REL = ".claude/statusline/software-teams-statusline.py";
const SETTINGS_LOCAL_REL = ".claude/settings.local.json";

const oneUp = join(import.meta.dir, "..");
const twoUp = join(import.meta.dir, "..", "..");
const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;

/** Shell command Claude Code runs for the statusLine (python3 + abs script path). */
function statuslineShellCommand(cwd: string): string {
  return `python3 "${join(cwd, SCRIPT_REL)}"`;
}

/** Copy the renderer from the package template into the project if missing/forced. */
async function ensureScript(cwd: string, force: boolean): Promise<void> {
  const dest = join(cwd, SCRIPT_REL);
  const src = join(packageRoot, "templates", SCRIPT_REL);
  if (!existsSync(src)) {
    throw new Error(`statusline renderer not found in package at ${src}`);
  }
  if (force || !existsSync(dest)) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(src, "utf8"), "utf8");
    const srcStat = await stat(src);
    await chmod(dest, srcStat.mode | 0o111);
  }
}

function pointsAtUs(settings: Record<string, unknown>): boolean {
  const sl = settings.statusLine as { command?: string } | undefined;
  return Boolean(sl?.command && sl.command.includes(SCRIPT_REL));
}

export async function installStatusline(cwd: string, force: boolean): Promise<number> {
  await ensureScript(cwd, force);

  const settingsPath = join(cwd, SETTINGS_LOCAL_REL);
  const settings = await readSettings(settingsPath);

  const existing = settings.statusLine as { command?: string } | undefined;
  if (existing && !pointsAtUs(settings as Record<string, unknown>) && !force) {
    consola.warn(
      `A different statusLine is already set in ${SETTINGS_LOCAL_REL}:\n  ${existing.command ?? JSON.stringify(existing)}`,
    );
    consola.info("Refusing to overwrite it. Re-run with --force to replace it, or wire it yourself:");
    console.log(printSnippet(cwd));
    return 1;
  }

  const next = { ...settings, statusLine: { type: "command", command: statuslineShellCommand(cwd) } };
  await writeSettings(settingsPath, next);
  consola.success(`Software Teams statusline installed → ${SETTINGS_LOCAL_REL}`);
  consola.info(`Renderer: ${SCRIPT_REL} (requires python3). Disable with: software-teams statusline --uninstall`);
  return 0;
}

export async function uninstallStatusline(cwd: string): Promise<number> {
  const settingsPath = join(cwd, SETTINGS_LOCAL_REL);
  if (!existsSync(settingsPath)) {
    consola.info("No settings.local.json — nothing to uninstall.");
    return 0;
  }
  const settings = await readSettings(settingsPath);
  if (!pointsAtUs(settings as Record<string, unknown>)) {
    consola.info("statusLine does not point at the Software Teams renderer — leaving it untouched.");
    return 0;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop statusLine via rest spread
  const { statusLine: _drop, ...rest } = settings;
  await writeSettings(settingsPath, rest);
  consola.success(`Software Teams statusline removed from ${SETTINGS_LOCAL_REL}.`);
  return 0;
}

function printSnippet(cwd: string): string {
  return JSON.stringify({ statusLine: { type: "command", command: statuslineShellCommand(cwd) } }, null, 2);
}

export async function statuslineStatus(cwd: string): Promise<number> {
  const settingsPath = join(cwd, SETTINGS_LOCAL_REL);
  const scriptPresent = existsSync(join(cwd, SCRIPT_REL));
  const settings = existsSync(settingsPath) ? await readSettings(settingsPath) : {};
  const wired = pointsAtUs(settings as Record<string, unknown>);
  console.log("Software Teams statusline:");
  console.log(`  renderer script (${SCRIPT_REL}): ${scriptPresent ? "present" : "missing"}`);
  console.log(`  wired in ${SETTINGS_LOCAL_REL}: ${wired ? "yes" : "no"}`);
  console.log(wired ? "→ ON" : "→ OFF (enable with: software-teams statusline --install)");
  return 0;
}

export const statuslineCommand = defineCommand({
  meta: {
    name: "statusline",
    description: "Install/remove the Software Teams statusline (plan · phase · wave · task) in settings.local.json",
  },
  args: {
    install: { type: "boolean", description: "Copy the renderer and wire settings.local.json", default: false },
    uninstall: { type: "boolean", description: "Remove the statusLine entry if it is ours", default: false },
    print: { type: "boolean", description: "Print the settings.local.json snippet to wire it manually", default: false },
    force: { type: "boolean", description: "Overwrite an existing unrelated statusLine", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    try {
      if (args.uninstall) return process.exit(await uninstallStatusline(cwd));
      if (args.print) {
        await ensureScript(cwd, false);
        console.log(printSnippet(cwd));
        return process.exit(0);
      }
      if (args.install) return process.exit(await installStatusline(cwd, Boolean(args.force)));
      return process.exit(await statuslineStatus(cwd));
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err));
      return process.exit(1);
    }
  },
});
