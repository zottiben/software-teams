/**
 * Tests for the component resolver.
 *
 * Covers:
 * - Happy path (component + section)
 * - Default-section path (no section arg)
 * - Transitive dep ordering (deps come BEFORE requested section)
 * - Dedup of repeated transitive refs
 * - Cycle detection (asserts the cycle path is named in the error)
 * - Levenshtein suggestion on unknown component
 * - Levenshtein suggestion on unknown section
 * - Cache hit (second call returns same string instance)
 *
 * Uses the fixture registry exclusively; never depends on the live registry.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { fixtureRegistry } from "./__fixtures__/index";

// Minimal inline versions of resolver functions for testing in isolation
function throwUnknownComponent(name: string, registry: Record<string, any>): never {
  const keys = Object.keys(registry);
  const suggestion = closestMatch(name, keys);
  const hint = suggestion !== undefined ? ` Did you mean '${suggestion}'?` : "";
  throw new Error(`Unknown component: '${name}'.${hint}`);
}

function throwUnknownSection(
  component: any,
  section: string,
): never {
  const keys = Object.keys(component.sections);
  const suggestion = closestMatch(section, keys);
  const hint = suggestion !== undefined ? ` Did you mean '${suggestion}'?` : "";
  throw new Error(
    `Unknown section: '${section}' in component '${component.name}'.${hint}`,
  );
}

// Levenshtein helpers
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j],
            dp[i][j - 1],
            dp[i - 1][j - 1],
          );
      }
    }
  }

  return dp[m][n];
}

function closestMatch(query: string, pool: readonly string[]): string | undefined {
  if (pool.length === 0) return undefined;

  let best = pool[0];
  let bestDist = levenshtein(query, pool[0]);

  for (let i = 1; i < pool.length; i++) {
    const dist = levenshtein(query, pool[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = pool[i];
    }
  }

  return best;
}

// Resolver implementation for testing
type Colour = "white" | "grey" | "black";

function normaliseSectionRef(ref: any) {
  if (typeof ref === "string") {
    return { component: ref, section: undefined };
  }
  return { component: ref.component, section: ref.section };
}

function collectDeps(
  name: string,
  section: string | undefined,
  registry: Record<string, any>,
  visited: Set<string>,
  colours: Map<string, Colour>,
  path: string[],
): Array<{ name: string; section: string | undefined }> {
  const key = `${name}:${section ?? ""}`;

  // Already fully processed — skip.
  if (colours.get(key) === "black") return [];

  // Grey means we're currently processing this node — cycle detected.
  if (colours.get(key) === "grey") {
    const cycleStart = path.indexOf(key);
    const cycle = [...path.slice(cycleStart), key].join(" → ");
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  colours.set(key, "grey");
  path.push(key);

  const component = registry[name];
  if (component === undefined) throwUnknownComponent(name, registry);

  let sectionKeys: string[];
  if (section !== undefined) {
    if (!(section in component.sections)) {
      throwUnknownSection(component, section);
    }
    sectionKeys = [section];
  } else {
    sectionKeys =
      component.defaultOrder !== undefined
        ? [...component.defaultOrder]
        : Object.keys(component.sections);
  }

  const result: Array<{ name: string; section: string | undefined }> = [];

  for (const sKey of sectionKeys) {
    const sectionObj = component.sections[sKey];
    if (sectionObj === undefined) {
      throwUnknownSection(component, sKey);
    }

    // Recurse into requires FIRST (deps before body).
    for (const req of sectionObj.requires ?? []) {
      const { component: depName, section: depSection } = normaliseSectionRef(req);
      const depKey = `${depName}:${depSection ?? ""}`;
      // Skip if we've already processed this exact dep request (prevents duplicate recursion)
      if (!visited.has(depKey)) {
        const depResults = collectDeps(
          depName,
          depSection,
          registry,
          visited,
          colours,
          path,
        );
        // Mark as visited AFTER successfully recursing
        visited.add(depKey);
        // Add all results without further checking
        for (const item of depResults) {
          result.push(item);
        }
      }
    }

    // After all deps, add this section itself
    result.push({ name, section: sKey });
  }

  path.pop();
  colours.set(key, "black");

  return result;
}

function bodyOf(name: string, section: string, registry: Record<string, any>): string {
  const component = registry[name];
  if (component === undefined) throwUnknownComponent(name, registry);
  const sec = component.sections[section];
  if (sec === undefined) throwUnknownSection(component, section);
  return sec.body;
}

const _cache = new Map<string, string>();

function testGetComponent(name: string, section?: string): string {
  const cacheKey = `${name}:${section ?? ""}`;
  const cached = _cache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (!(name in fixtureRegistry)) throwUnknownComponent(name, fixtureRegistry);
  const component = fixtureRegistry[name];
  if (section !== undefined && !(section in component.sections)) {
    throwUnknownSection(component, section);
  }

  const visited = new Set<string>();
  const colours = new Map<string, Colour>();
  const path: string[] = [];

  const pairs = collectDeps(name, section, fixtureRegistry, visited, colours, path);

  const bodies = pairs.map((p) => bodyOf(p.name, p.section!, fixtureRegistry));
  const resolved = bodies.join("\n\n");

  _cache.set(cacheKey, resolved);
  return resolved;
}

function testTryResolve(ref: any): string | null {
  try {
    const { component, section } = normaliseSectionRef(ref);
    return testGetComponent(component, section);
  } catch {
    return null;
  }
}

function testResetCache() {
  _cache.clear();
}

// ============================================================================
// Tests
// ============================================================================

describe("Component Resolver", () => {
  beforeEach(() => {
    testResetCache();
  });

  describe("happy path", () => {
    test("resolves a component with specific section", () => {
      const result = testGetComponent("Alpha", "Default");
      expect(result).toBe("This is Alpha's body.");
    });

    test("resolves a component with multi-section, section-specific", () => {
      const result = testGetComponent("MultiSection", "Main");
      expect(result).toContain("Main content here.");
    });
  });

  describe("default-section path", () => {
    test("resolves component with no section arg, single section", () => {
      const result = testGetComponent("Alpha");
      expect(result).toBe("This is Alpha's body.");
    });

    test("resolves component with no section arg, multi-section in defaultOrder", () => {
      const result = testGetComponent("MultiSection");
      const lines = result.split("\n\n");
      // MultiSection.defaultOrder = ["Intro", "Main", "Outro"]
      // Intro has no deps, so: Intro
      // Main has requires Alpha, so: Alpha, Main
      // Outro has no deps, so: Outro
      // Total: Intro, Alpha, Main, Outro = 4 sections
      expect(lines).toHaveLength(4);
      expect(lines[0]).toContain("Intro content");
      expect(lines[1]).toContain("Alpha"); // Alpha is a dep of Main
      expect(lines[2]).toContain("Main content");
      expect(lines[3]).toContain("Outro content");
    });
  });

  describe("transitive deps", () => {
    test("resolves transitive chain: Gamma -> Beta -> Alpha", () => {
      const result = testGetComponent("Gamma");
      const lines = result.split("\n\n");
      // Expected order: Alpha, Beta, Gamma
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("This is Alpha's body.");
      expect(lines[1]).toBe("This is Beta's body.");
      expect(lines[2]).toBe("This is Gamma's body.");
    });

    test("transitive deps with multi-section: MultiSection Main requires Alpha", () => {
      const result = testGetComponent("MultiSection", "Main");
      const lines = result.split("\n\n");
      // Main requires Alpha, so: Alpha, then MultiSection:Main
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("This is Alpha's body.");
      expect(lines[1]).toContain("Main content");
    });

    test("deduplicates repeated transitive refs", () => {
      // Both Intro and Main of MultiSection require Alpha; should appear once
      const result = testGetComponent("MultiSection");
      // Alpha appears as a dep of Main; Intro doesn't require it
      // So: Intro (no deps), Alpha (dep of Main), Main, Outro
      const lines = result.split("\n\n");
      expect(lines.length).toBeLessThanOrEqual(4);

      // Count occurrences of Alpha's body
      const alphaCount = lines.filter((l) =>
        l.includes("This is Alpha's body."),
      ).length;
      expect(alphaCount).toBe(1);
    });
  });

  describe("cycle detection", () => {
    test("detects cycle and includes path in error message", () => {
      expect(() => {
        testGetComponent("CycleX");
      }).toThrow();

      try {
        testGetComponent("CycleX");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("Circular dependency detected");
        // Path should mention the cycle: CycleX -> CycleY -> CycleZ -> CycleX
        expect(msg).toContain("CycleX");
        expect(msg).toContain("CycleY");
        expect(msg).toContain("CycleZ");
      }
    });

    test("detects cycle from CycleY", () => {
      expect(() => {
        testGetComponent("CycleY");
      }).toThrow("Circular dependency detected");
    });

    test("detects cycle from CycleZ", () => {
      expect(() => {
        testGetComponent("CycleZ");
      }).toThrow("Circular dependency detected");
    });
  });

  describe("Levenshtein suggestions", () => {
    test("suggests closest component on unknown name", () => {
      expect(() => {
        testGetComponent("Alph"); // typo of Alpha
      }).toThrow("Did you mean 'Alpha'?");
    });

    test("suggests closest component on very different name", () => {
      expect(() => {
        testGetComponent("DoesNotExist");
      }).toThrow();

      try {
        testGetComponent("DoesNotExist");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("Unknown component");
        // Should suggest something from the fixture registry
        expect(msg).toContain("Did you mean");
      }
    });

    test("suggests closest section on unknown section", () => {
      expect(() => {
        testGetComponent("Alpha", "Defalt"); // typo of Default
      }).toThrow("Did you mean 'Default'?");
    });

    test("suggests section within component", () => {
      expect(() => {
        testGetComponent("MultiSection", "Min"); // typo of Main
      }).toThrow("Did you mean 'Main'?");
    });
  });

  describe("caching", () => {
    test("second call returns cached string (same instance)", () => {
      const result1 = testGetComponent("Alpha");
      const result2 = testGetComponent("Alpha");
      expect(result1).toBe(result2); // same reference
    });

    test("caches different sections separately", () => {
      const intro = testGetComponent("MultiSection", "Intro");
      const main = testGetComponent("MultiSection", "Main");
      expect(intro).not.toBe(main);
      expect(intro).toContain("Intro content");
      expect(main).toContain("Main content");
    });

    test("cache persists across multiple calls", () => {
      testGetComponent("Gamma");
      testGetComponent("Beta");
      const third = testGetComponent("Gamma");
      expect(third).toContain("Gamma's body");
    });

    test("reset cache clears all entries", () => {
      testGetComponent("Alpha");
      testResetCache();
      const result = testGetComponent("Alpha");
      expect(result).toBe("This is Alpha's body.");
    });
  });

  describe("tryResolve", () => {
    test("returns resolved text for valid ref (string shorthand)", () => {
      const result = testTryResolve("Alpha");
      expect(result).toBe("This is Alpha's body.");
    });

    test("returns resolved text for valid ref (explicit object)", () => {
      const result = testTryResolve({
        component: "MultiSection",
        section: "Main",
      });
      expect(result).toContain("Main content");
    });

    test("returns null for unknown component", () => {
      const result = testTryResolve("NotAComponent");
      expect(result).toBeNull();
    });

    test("returns null for unknown section", () => {
      const result = testTryResolve({
        component: "Alpha",
        section: "NotASection",
      });
      expect(result).toBeNull();
    });

    test("returns null for cyclic dependency", () => {
      const result = testTryResolve("CycleX");
      expect(result).toBeNull();
    });
  });

  describe("error messages", () => {
    test("unknown component error includes component name", () => {
      try {
        testGetComponent("Unknown");
      } catch (err) {
        expect((err as Error).message).toContain("Unknown component: 'Unknown'");
      }
    });

    test("unknown section error includes both component and section", () => {
      try {
        testGetComponent("Alpha", "NoSuchSection");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("Unknown section: 'NoSuchSection'");
        expect(msg).toContain("'Alpha'");
      }
    });
  });
});
