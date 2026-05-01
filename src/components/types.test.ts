/**
 * Smoke tests for component types.
 *
 * Verifies:
 * - Type imports work correctly
 * - Runtime construction of components is possible
 * - Key interface structures align with spec
 */

import { describe, test, expect } from "bun:test";
import type {
  Component,
  ComponentSection,
  SectionRef,
  ComponentCategory,
  ComponentParam,
} from "./types";

describe("Component Types", () => {
  test("imports resolve without error", () => {
    // If we got here, the imports worked.
    expect(true).toBe(true);
  });

  test("can construct a minimal Component at runtime", () => {
    const component: Component = {
      name: "TestComponent",
      category: "meta" as const,
      description: "A test component",
      sections: {
        Default: {
          name: "Default",
          description: "Default section",
          body: "Body content",
        },
      },
    };

    expect(component.name).toBe("TestComponent");
    expect(component.category).toBe("meta");
    expect(component.sections).toHaveProperty("Default");
  });

  test("can construct a section with requires", () => {
    const section: ComponentSection = {
      name: "Section1",
      description: "A section with deps",
      body: "Content",
      requires: ["OtherComponent", { component: "AnotherOne", section: "Specific" }],
    };

    expect(section.requires).toHaveLength(2);
    expect(section.requires?.[0]).toBe("OtherComponent");
    expect(section.requires?.[1]).toEqual({
      component: "AnotherOne",
      section: "Specific",
    });
  });

  test("can construct a component with params", () => {
    const param: ComponentParam = {
      name: "strictMode",
      type: "boolean",
      required: false,
      default: true,
      description: "Enable strict checking",
    };

    expect(param.type).toBe("boolean");
    expect(param.default).toBe(true);
  });

  test("can construct a component with defaultOrder", () => {
    const component: Component = {
      name: "Ordered",
      category: "execution",
      description: "Component with section order",
      defaultOrder: ["First", "Second", "Third"],
      sections: {
        First: { name: "First", description: "F", body: "1" },
        Second: { name: "Second", description: "S", body: "2" },
        Third: { name: "Third", description: "T", body: "3" },
      },
    };

    expect(component.defaultOrder).toEqual(["First", "Second", "Third"]);
  });

  test("ComponentCategory is a union of four strings", () => {
    const categories: ComponentCategory[] = [
      "meta",
      "execution",
      "planning",
      "quality",
    ];

    expect(categories).toHaveLength(4);
    expect(categories).toContain("meta");
    expect(categories).toContain("execution");
  });

  test("SectionRef can be string or object", () => {
    const shorthand: SectionRef = "ComponentName";
    const explicit: SectionRef = {
      component: "ComponentName",
      section: "SectionName",
    };

    expect(typeof shorthand).toBe("string");
    expect(typeof explicit).toBe("object");
    expect(explicit.component).toBe("ComponentName");
    expect(explicit.section).toBe("SectionName");
  });
});
