export interface JdiStorage {
  load(key: string): Promise<string | null>;
  save(key: string, content: string): Promise<void>;
}
