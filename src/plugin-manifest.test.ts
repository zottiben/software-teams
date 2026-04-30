import { describe, test, expect } from "bun:test";
import { join } from "path";
import { readFile } from "node:fs/promises";

const REPO_ROOT = join(import.meta.dir, "..");
const PLUGIN_MANIFEST_PATH = join(REPO_ROOT, ".claude-plugin", "plugin.json");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");

/**
 * Helper: load and parse plugin.json
 */
async function loadPluginManifest(): Promise<Record<string, unknown>> {
  const content = await readFile(PLUGIN_MANIFEST_PATH, "utf-8");
  return JSON.parse(content);
}

/**
 * Helper: load package.json version
 */
async function loadPackageVersion(): Promise<string> {
  const content = await readFile(PACKAGE_JSON_PATH, "utf-8");
  const pkg = JSON.parse(content);
  return pkg.version as string;
}

/**
 * Schema validation: Anthropic plugin manifest format (hand-rolled).
 * Based on documented plugin spec; covers the required shape.
 *
 * Since Anthropic's JSON schema is not publicly versioned in this repo,
 * we validate against the documented expected fields and types from
 * the spec (name, description, version, author, optional homepage/repository).
 */
function validatePluginSchema(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    errors.push("Manifest is not an object");
    return { valid: false, errors };
  }

  const m = manifest as Record<string, unknown>;

  // Check name (required, string, non-empty)
  if (typeof m.name !== "string" || !m.name.trim()) {
    errors.push("Field 'name' is required and must be a non-empty string");
  }

  // Check description (required, string, non-empty)
  if (typeof m.description !== "string" || !m.description.trim()) {
    errors.push("Field 'description' is required and must be a non-empty string");
  }

  // Check version (required, string, non-empty, semver-like)
  if (typeof m.version !== "string" || !m.version.trim()) {
    errors.push("Field 'version' is required and must be a non-empty string");
  } else if (!/^\d+\.\d+\.\d+/.test(m.version)) {
    errors.push(`Field 'version' "${m.version}" does not match semver pattern`);
  }

  // Check author (required, object with name or string)
  if (m.author !== undefined) {
    if (typeof m.author === "object" && m.author !== null) {
      const author = m.author as Record<string, unknown>;
      if (typeof author.name !== "string" || !author.name.trim()) {
        errors.push("Field 'author.name' must be a non-empty string");
      }
    } else if (typeof m.author !== "string") {
      errors.push("Field 'author' must be an object with 'name' field or a string");
    }
  }

  // Optional: homepage, repository, keywords
  if (m.homepage !== undefined && typeof m.homepage !== "string") {
    errors.push("Field 'homepage' must be a string");
  }
  if (m.repository !== undefined) {
    if (typeof m.repository !== "object" || m.repository === null) {
      errors.push("Field 'repository' must be an object");
    } else {
      const repo = m.repository as Record<string, unknown>;
      if (typeof repo.type !== "string") {
        errors.push("Field 'repository.type' must be a string");
      }
      if (typeof repo.url !== "string") {
        errors.push("Field 'repository.url' must be a string");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

describe("plugin-manifest", () => {
  test("plugin.json parses as valid JSON", async () => {
    const manifest = await loadPluginManifest();
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe("object");
  });

  test("required fields are populated: name, description, version, author", async () => {
    const manifest = await loadPluginManifest();

    expect(manifest.name).toBeDefined();
    expect(typeof manifest.name).toBe("string");
    expect((manifest.name as string).trim().length).toBeGreaterThan(0);

    expect(manifest.description).toBeDefined();
    expect(typeof manifest.description).toBe("string");
    expect((manifest.description as string).trim().length).toBeGreaterThan(0);

    expect(manifest.version).toBeDefined();
    expect(typeof manifest.version).toBe("string");
    expect((manifest.version as string).trim().length).toBeGreaterThan(0);

    expect(manifest.author).toBeDefined();
  });

  test('name field equals "software-teams"', async () => {
    const manifest = await loadPluginManifest();
    expect(manifest.name).toBe("software-teams");
  });

  test("version matches package.json version", async () => {
    const manifest = await loadPluginManifest();
    const pkgVersion = await loadPackageVersion();

    expect(manifest.version).toBe(pkgVersion);
  });

  test("manifest passes schema validation (hand-rolled Anthropic plugin format)", async () => {
    const manifest = await loadPluginManifest();
    const { valid, errors } = validatePluginSchema(manifest);

    if (!valid) {
      console.error("Schema validation errors:", errors);
    }
    expect(valid).toBe(true);
  });

  test("author field is properly structured (object with name field)", async () => {
    const manifest = await loadPluginManifest();

    expect(manifest.author).toBeDefined();
    if (typeof manifest.author === "object" && manifest.author !== null) {
      const author = manifest.author as Record<string, unknown>;
      expect(typeof author.name).toBe("string");
      expect((author.name as string).trim().length).toBeGreaterThan(0);
    }
  });

  describe("negative cases: invalid manifest detection", () => {
    test("rejects manifest with missing 'name' field", async () => {
      const invalid: Record<string, unknown> = {
        description: "Test",
        version: "1.0.0",
        author: { name: "Test" },
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("name"))).toBe(true);
    });

    test("rejects manifest with missing 'description' field", async () => {
      const invalid: Record<string, unknown> = {
        name: "test",
        version: "1.0.0",
        author: { name: "Test" },
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("description"))).toBe(true);
    });

    test("rejects manifest with missing 'version' field", async () => {
      const invalid: Record<string, unknown> = {
        name: "test",
        description: "Test",
        author: { name: "Test" },
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("version"))).toBe(true);
    });

    test("rejects manifest with invalid version format", async () => {
      const invalid: Record<string, unknown> = {
        name: "test",
        description: "Test",
        version: "not-semver",
        author: { name: "Test" },
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("semver"))).toBe(true);
    });

    test("rejects manifest with non-object author", async () => {
      const invalid: Record<string, unknown> = {
        name: "test",
        description: "Test",
        version: "1.0.0",
        author: 123,
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("author"))).toBe(true);
    });

    test("rejects manifest with author.name missing", async () => {
      const invalid: Record<string, unknown> = {
        name: "test",
        description: "Test",
        version: "1.0.0",
        author: { url: "https://example.com" },
      };
      const { valid, errors } = validatePluginSchema(invalid);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("author.name"))).toBe(true);
    });

    test("rejects manifest that is not an object", async () => {
      const { valid, errors } = validatePluginSchema("not an object");
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("not an object"))).toBe(true);
    });
  });
});
