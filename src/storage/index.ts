import { join } from "path";
import { existsSync } from "fs";
import { parse } from "yaml";
import { FsStorage } from "./fs-storage";
import type { JdiStorage } from "./interface";

export type { JdiStorage } from "./interface";
export { FsStorage } from "./fs-storage";

export interface StorageConfig {
  adapter?: string;
  basePath?: string;
}

/**
 * Create a storage adapter based on config or jdi-config.yaml.
 *
 * Built-in adapters:
 *   - "fs" (default) — reads/writes to a local directory
 *
 * Custom adapters:
 *   Set `storage.adapter` in jdi-config.yaml to a relative path (e.g. "./my-storage.ts").
 *   The file must export a class that implements JdiStorage as default export:
 *
 *   ```ts
 *   import type { JdiStorage } from "@benzotti/jdi/storage";
 *
 *   export default class S3Storage implements JdiStorage {
 *     async load(key: string) { ... }
 *     async save(key: string, content: string) { ... }
 *   }
 *   ```
 */
export async function createStorage(
  cwd: string,
  config?: StorageConfig,
): Promise<JdiStorage> {
  let adapter = config?.adapter ?? "fs";
  let basePath = config?.basePath;

  // Read from jdi-config.yaml if no explicit config
  if (!config?.adapter && !config?.basePath) {
    const configPath = join(cwd, ".jdi", "config", "jdi-config.yaml");
    if (existsSync(configPath)) {
      const content = await Bun.file(configPath).text();
      const parsed = parse(content);
      if (parsed?.storage?.adapter) adapter = parsed.storage.adapter;
      if (parsed?.storage?.base_path) basePath = parsed.storage.base_path;
    }
  }

  // Built-in: filesystem adapter
  if (adapter === "fs") {
    const resolvedPath = basePath
      ? join(cwd, basePath)
      : join(cwd, ".jdi", "persistence");
    return new FsStorage(resolvedPath);
  }

  // Custom adapter: resolve as a relative path to a module
  const adapterPath = join(cwd, adapter);
  if (!existsSync(adapterPath)) {
    throw new Error(
      `Storage adapter not found: ${adapterPath}\n` +
      `Set storage.adapter in .jdi/config/jdi-config.yaml to "fs" or a path to a custom adapter module.`,
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

    // Validate it implements JdiStorage
    if (typeof instance.load !== "function" || typeof instance.save !== "function") {
      throw new Error(
        `Storage adapter at ${adapterPath} must implement JdiStorage (load and save methods).`,
      );
    }

    return instance as JdiStorage;
  } catch (err: any) {
    if (err.message?.includes("Storage adapter")) throw err;
    throw new Error(`Failed to load storage adapter from ${adapterPath}: ${err.message}`);
  }
}
