import { join } from "path";
import { existsSync } from "fs";
import { parse } from "yaml";

export interface AdapterConfig {
  quality_gates?: Record<string, unknown>;
  dependency_install?: string;
  worktree?: {
    env_setup?: string[];
    database?: { create?: string; migrate?: string; seed?: string; drop?: string };
    web_server?: { setup?: string; cleanup?: string };
    cleanup?: string[];
  };
  conventions?: Record<string, unknown>;
  tech_stack?: Record<string, unknown>;
}

export async function readAdapter(cwd: string): Promise<AdapterConfig | null> {
  const adapterPath = join(cwd, ".jdi", "config", "adapter.yaml");
  if (!existsSync(adapterPath)) return null;

  const content = await Bun.file(adapterPath).text();
  return parse(content) as AdapterConfig;
}
