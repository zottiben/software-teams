import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installStatusline, uninstallStatusline } from "../statusline";

const SCRIPT_REL = ".claude/statusline/software-teams-statusline.py";
const SETTINGS = ".claude/settings.local.json";

async function readStatusLine(dir: string): Promise<{ command?: string } | undefined> {
  const p = join(dir, SETTINGS);
  if (!existsSync(p)) return undefined;
  return (JSON.parse(await readFile(p, "utf8")).statusLine) as { command?: string } | undefined;
}

describe("statusline install/uninstall", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "st-sl-"));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test("install copies the renderer and wires settings.local.json", async () => {
    const code = await installStatusline(dir, false);
    expect(code).toBe(0);
    expect(existsSync(join(dir, SCRIPT_REL))).toBe(true);
    const sl = await readStatusLine(dir);
    expect(sl?.command).toContain(SCRIPT_REL);
    expect(sl?.command).toContain("python3");
  });

  test("install is idempotent (no error on re-run)", async () => {
    await installStatusline(dir, false);
    const code = await installStatusline(dir, false);
    expect(code).toBe(0);
  });

  test("install preserves other settings.local.json keys", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, SETTINGS), JSON.stringify({ permissions: { allow: ["Read"] } }) + "\n");
    await installStatusline(dir, false);
    const parsed = JSON.parse(await readFile(join(dir, SETTINGS), "utf8"));
    expect(parsed.permissions).toEqual({ allow: ["Read"] });
    expect(parsed.statusLine?.command).toContain(SCRIPT_REL);
  });

  test("install refuses to clobber a foreign statusLine without --force", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, SETTINGS), JSON.stringify({ statusLine: { type: "command", command: "my-own" } }) + "\n");
    const code = await installStatusline(dir, false);
    expect(code).toBe(1);
    expect((await readStatusLine(dir))?.command).toBe("my-own"); // untouched
  });

  test("install --force replaces a foreign statusLine", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, SETTINGS), JSON.stringify({ statusLine: { type: "command", command: "my-own" } }) + "\n");
    const code = await installStatusline(dir, true);
    expect(code).toBe(0);
    expect((await readStatusLine(dir))?.command).toContain(SCRIPT_REL);
  });

  test("uninstall removes our statusLine but leaves a foreign one", async () => {
    await installStatusline(dir, false);
    expect(await uninstallStatusline(dir)).toBe(0);
    expect(await readStatusLine(dir)).toBeUndefined();

    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, SETTINGS), JSON.stringify({ statusLine: { type: "command", command: "my-own" } }) + "\n");
    await uninstallStatusline(dir);
    expect((await readStatusLine(dir))?.command).toBe("my-own");
  });
});
