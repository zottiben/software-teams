import { join, basename } from "path";
import { homedir } from "os";

interface ResolvedComponent {
  name: string;
  path: string;
  source: "project" | "user" | "builtin";
}

export async function resolveComponents(cwd: string): Promise<ResolvedComponent[]> {
  const components: ResolvedComponent[] = [];
  const seen = new Set<string>();

  // Resolution chain: project > user > built-in
  const sources: Array<{ dir: string; source: ResolvedComponent["source"] }> = [
    { dir: join(cwd, ".software-teams", "framework", "components"), source: "project" },
    { dir: join(homedir(), ".software-teams", "components"), source: "user" },
    { dir: join(import.meta.dir, "../framework/components"), source: "builtin" },
  ];

  for (const { dir, source } of sources) {
    try {
      const glob = new Bun.Glob("**/*.md");
      for await (const file of glob.scan({ cwd: dir })) {
        const name = basename(file, ".md");
        if (!seen.has(name)) {
          seen.add(name);
          components.push({ name, path: join(dir, file), source });
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}
