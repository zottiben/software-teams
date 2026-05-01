/**
 * Tests for the component registry.
 *
 * Verifies:
 * - Registry population (16 components registered)
 * - Category validity (all categories are one of the four canonical types)
 * - No duplicate names or sections within a component
 * - Transitive requires resolution via tryResolve
 * - Snapshot equality for three spot-check components (AgentBase, Verify, AgentRouter)
 */

import { describe, test, expect } from "bun:test";
import { registry, getRegistryKeys } from "./registry";
import { getComponent } from "./resolve";
import type { ComponentCategory } from "./types";

describe("Component Registry", () => {
  test("registry contains exactly 16 components", () => {
    expect(Object.keys(registry).length).toBe(16);
  });

  test("all components have valid categories", () => {
    const validCategories: readonly ComponentCategory[] = [
      "meta",
      "execution",
      "planning",
      "quality",
    ];

    for (const component of Object.values(registry)) {
      expect(validCategories).toContain(component.category);
    }
  });

  test("no duplicate component names", () => {
    const names = Object.keys(registry);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test("no duplicate section names within any component", () => {
    for (const [key, component] of Object.entries(registry)) {
      const sectionNames = Object.keys(component.sections);
      const uniqueSectionNames = new Set(sectionNames);
      expect(
        uniqueSectionNames.size,
        `Component ${key} has duplicate section names`,
      ).toBe(sectionNames.length);
    }
  });

  test("every section's requires resolves via getComponent", () => {
    for (const component of Object.values(registry)) {
      for (const section of Object.values(component.sections)) {
        if (!section.requires) continue;

        for (const ref of section.requires) {
          if (typeof ref === "string") {
            // Shorthand: whole-component reference
            expect(() => {
              getComponent(ref);
            }).not.toThrow();
          } else {
            // Explicit: component + section reference
            expect(() => {
              getComponent(ref.component, ref.section);
            }).not.toThrow();
          }
        }
      }
    }
  });

  test("getRegistryKeys returns sorted keys", () => {
    const keys = getRegistryKeys();
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  test("AgentBase snapshot matches expected output", () => {
    const agentBaseOutput = getComponent("AgentBase");
    expect(agentBaseOutput).toMatchSnapshot("AgentBase");
  });

  test("Verify snapshot matches expected output", () => {
    const verifyOutput = getComponent("Verify");
    expect(verifyOutput).toMatchSnapshot("Verify");
  });

  test("AgentRouter snapshot matches expected output", () => {
    const agentRouterOutput = getComponent("AgentRouter");
    expect(agentRouterOutput).toMatchSnapshot("AgentRouter");
  });

  test("all 16 components are accessible via registry keys", () => {
    const keys = getRegistryKeys();
    expect(keys.length).toBe(16);

    const expectedNames = [
      "AgentBase",
      "AgentRouter",
      "AgentTeamsOrchestration",
      "CodebaseContext",
      "Commit",
      "ComplexityRouter",
      "InteractiveGate",
      "PRReview",
      "SilentDiscovery",
      "StateUpdate",
      "StrictnessProtocol",
      "TaskBreakdown",
      "TeamRouter",
      "Verify",
      "VerifyAdvanced",
      "WaveComputation",
    ];

    const actualNames = keys.sort();
    expect(actualNames).toEqual(expectedNames);
  });

  test("each registered component has a non-empty description", () => {
    for (const component of Object.values(registry)) {
      expect(component.description).toBeTruthy();
      expect(component.description.length).toBeGreaterThan(0);
    }
  });

  test("each section has a description", () => {
    for (const component of Object.values(registry)) {
      for (const section of Object.values(component.sections)) {
        expect(section.description).toBeTruthy();
        expect(section.description.length).toBeGreaterThan(0);
      }
    }
  });

  test("T1 regression guard: every section key matches /^[A-Za-z][A-Za-z0-9-]*$/", () => {
    const addressableKeyRegex = /^[A-Za-z][A-Za-z0-9-]*$/;

    for (const [componentName, component] of Object.entries(registry)) {
      for (const [sectionKey] of Object.entries(component.sections)) {
        expect(
          sectionKey,
          `Component '${componentName}' has non-addressable section key: '${sectionKey}'`,
        ).toMatch(addressableKeyRegex);
      }
    }
  });
});
