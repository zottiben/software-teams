import { describe, test, expect } from "bun:test";
import { dottedGet } from "../yaml-edit";

describe("dottedGet", () => {
  test("returns top-level field", () => {
    expect(dottedGet({ name: "demo" }, "name")).toBe("demo");
  });

  test("walks nested object path", () => {
    expect(dottedGet({ position: { plan: "02" } }, "position.plan")).toBe("02");
  });

  test("returns undefined for missing key", () => {
    expect(dottedGet({ name: "demo" }, "nope")).toBeUndefined();
    expect(dottedGet({ position: { plan: "02" } }, "position.task")).toBeUndefined();
  });

  test("returns undefined when walking through a non-object", () => {
    expect(dottedGet({ name: "demo" }, "name.something")).toBeUndefined();
  });

  test("indexes into arrays with numeric segments", () => {
    expect(dottedGet({ phases: [{ name: "A" }, { name: "B" }] }, "phases.1.name")).toBe("B");
  });

  test("returns undefined for out-of-bounds array index", () => {
    expect(dottedGet({ items: ["a", "b"] }, "items.5")).toBeUndefined();
  });

  test("supports numeric YAML keys parsed as numbers", () => {
    // YAML `phases: { 1: { ... } }` parses with numeric key 1; lookups
    // by string "1" should still find it.
    const data = { phases: { 1: { name: "Phase One" } } } as Record<string, unknown>;
    expect(dottedGet(data, "phases.1.name")).toBe("Phase One");
  });

  test("returns undefined for null cursor", () => {
    expect(dottedGet(null, "anything")).toBeUndefined();
    expect(dottedGet(undefined, "anything")).toBeUndefined();
  });

  test("returns the whole value when path is empty", () => {
    const obj = { a: 1, b: 2 };
    expect(dottedGet(obj, "")).toEqual(obj);
  });

  test("handles boolean and number leaf values", () => {
    expect(dottedGet({ done: true }, "done")).toBe(true);
    expect(dottedGet({ count: 0 }, "count")).toBe(0);
  });
});
