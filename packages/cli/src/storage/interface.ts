export interface SoftwareTeamsStorage {
  load(key: string): Promise<string | null>;
  save(key: string, content: string): Promise<void>;
}
