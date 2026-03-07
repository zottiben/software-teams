import { existsSync } from "fs";
import { join } from "path";

export type ProjectType = "laravel" | "nextjs" | "node" | "generic";

export async function detectProjectType(cwd: string): Promise<ProjectType> {
  // Laravel: composer.json with laravel/framework
  if (existsSync(join(cwd, "composer.json"))) {
    try {
      const composer = await Bun.file(join(cwd, "composer.json")).json();
      if (composer.require?.["laravel/framework"]) {
        return "laravel";
      }
    } catch {}
  }

  // Next.js: next.config.* files
  const nextConfigs = ["next.config.js", "next.config.mjs", "next.config.ts"];
  if (nextConfigs.some((f) => existsSync(join(cwd, f)))) {
    return "nextjs";
  }

  // Node: package.json exists
  if (existsSync(join(cwd, "package.json"))) {
    return "node";
  }

  return "generic";
}
