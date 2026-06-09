/**
 * Convenient re-export barrel for the component subsystem.
 *
 * Downstream code can do:
 *   import type { Component, ComponentSection, SectionRef, ComponentParam } from "../components";
 *   import { registry, getRegistryKeys, categories } from "../components";
 */

export type {
  Component,
  ComponentSection,
  ComponentCategory,
  ComponentParam,
  SectionRef,
} from "./types";

export { registry, getRegistryKeys, categories } from "./registry";

export { getComponent, getComponentInfo, tryResolve } from "./resolve";

export { validateRegistry } from "./validate";

export { levenshtein, closestMatch } from "./levenshtein";
