import { join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import type { JdiStorage } from "./interface";

export class FsStorage implements JdiStorage {
  private basePath: string;

  constructor(basePath: string = ".jdi/persistence") {
    this.basePath = basePath;
  }

  private resolveKey(key: string): string {
    const sanitized = key.replace(/[\/\\]/g, "_").replace(/\.\./g, "_");
    const filePath = join(this.basePath, `${sanitized}.md`);
    const resolved = resolve(filePath);
    if (!resolved.startsWith(resolve(this.basePath) + "/")) {
      throw new Error(`Storage key "${key}" resolves outside base path`);
    }
    return filePath;
  }

  async load(key: string): Promise<string | null> {
    const filePath = this.resolveKey(key);
    if (!existsSync(filePath)) return null;
    return Bun.file(filePath).text();
  }

  async save(key: string, content: string): Promise<void> {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
    const filePath = this.resolveKey(key);
    await Bun.write(filePath, content);
  }
}
