import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { JediStorage } from "./interface";

export class FsStorage implements JediStorage {
  private basePath: string;

  constructor(basePath: string = ".jdi/persistence") {
    this.basePath = basePath;
  }

  async load(key: string): Promise<string | null> {
    const filePath = join(this.basePath, `${key}.md`);
    if (!existsSync(filePath)) return null;
    return Bun.file(filePath).text();
  }

  async save(key: string, content: string): Promise<void> {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
    const filePath = join(this.basePath, `${key}.md`);
    await Bun.write(filePath, content);
  }
}
