import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { FsStorage } from "./fs-storage";
import type { SoftwareTeamsStorage } from "./interface";

export type { SoftwareTeamsStorage } from "./interface";
export { FsStorage } from "./fs-storage";

export interface StorageConfig {
  adapter?: string;
  basePath?: string;
}

/**
 * Create a storage adapter based on config or software-teams-config.yaml.
 *
 * Built-in adapters:
 *   - "fs" (default) — reads/writes to a local directory
 *
 * Custom adapters:
 *   Set `storage.adapter` in software-teams-config.yaml to a relative path (e.g. "./my-storage.ts").
 *   The file must export a class that implements SoftwareTeamsStorage as default export:
 *
 *   ```ts
 *   import type { SoftwareTeamsStorage } from "@websitelabs/software-teams/storage";
 *
 *   export default class S3Storage implements SoftwareTeamsStorage {
 *     async load(key: string) { ... }
 *     async save(key: string, content: string) { ... }
 *   }
 *   ```
 */
export async function createStorage(
  cwd: string,
  config?: StorageConfig,
): Promise<SoftwareTeamsStorage> {
  const resolvedStorageConfig = await (async (): Promise<{ adapter: string; basePath: string | undefined }> => {
    if (config?.adapter || config?.basePath) {
      return { adapter: config?.adapter ?? "fs", basePath: config?.basePath };
    }
    const configPath = join(cwd, ".software-teams", "config", "software-teams-config.yaml");
    if (!existsSync(configPath)) return { adapter: "fs", basePath: config?.basePath };
    const content = await Bun.file(configPath).text();
    const parsed = parse(content);
    return {
      adapter: (parsed?.storage?.adapter ?? "fs") as string,
      basePath: (parsed?.storage?.base_path ?? config?.basePath) as string | undefined,
    };
  })();
  const adapter = resolvedStorageConfig.adapter;
  const basePath = resolvedStorageConfig.basePath;

  if (adapter === "fs") {
    const resolvedPath = basePath
      ? join(cwd, basePath)
      : join(cwd, ".software-teams", "persistence");
    return new FsStorage(resolvedPath);
  }

  // Custom adapter: resolve as a relative path to a module
  const adapterPath = join(cwd, adapter);
  if (!existsSync(adapterPath)) {
    throw new Error(
      `Storage adapter not found: ${adapterPath}\n` +
      `Set storage.adapter in .software-teams/config/software-teams-config.yaml to "fs" or a path to a custom adapter module.`,
    );
  }

  try {
    const mod = await import(adapterPath);
    const AdapterClass = mod.default ?? mod.Storage ?? mod[Object.keys(mod)[0]];

    if (!AdapterClass || typeof AdapterClass !== "function") {
      throw new Error(
        `Storage adapter at ${adapterPath} must export a class as default export.`,
      );
    }

    const instance = new AdapterClass({ basePath, cwd });

    // Validate it implements SoftwareTeamsStorage
    if (typeof instance.load !== "function" || typeof instance.save !== "function") {
      throw new Error(
        `Storage adapter at ${adapterPath} must implement SoftwareTeamsStorage (load and save methods).`,
      );
    }

    return instance as SoftwareTeamsStorage;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Storage adapter")) throw err;
    throw new Error(`Failed to load storage adapter from ${adapterPath}: ${msg}`);
  }
}
