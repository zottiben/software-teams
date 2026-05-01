/**
 * Fixture registry for component tests.
 *
 * Provides a self-contained, synthetic registry with:
 * - A 2-step transitive dep chain (C -> B -> A)
 * - A cyclic triple (X -> Y -> Z -> X)
 * - A component with multiple sections
 * - A component with only a default section
 *
 * Tests use this registry exclusively; no dependency on the live registry.
 */

import type { Component } from "../types";


const Alpha: Component = {
  name: "Alpha",
  category: "meta",
  description: "Base component with one section",
  sections: {
    Default: {
      name: "Default",
      description: "Default section of Alpha",
      body: "This is Alpha's body.",
    },
  },
};

const Beta: Component = {
  name: "Beta",
  category: "meta",
  description: "Component that requires Alpha",
  sections: {
    Default: {
      name: "Default",
      description: "Default section of Beta",
      body: "This is Beta's body.",
      requires: ["Alpha"],
    },
  },
};

const Gamma: Component = {
  name: "Gamma",
  category: "execution",
  description: "Component that requires Beta (2-step transitive)",
  sections: {
    Default: {
      name: "Default",
      description: "Default section of Gamma",
      body: "This is Gamma's body.",
      requires: ["Beta"],
    },
  },
};

const MultiSection: Component = {
  name: "MultiSection",
  category: "planning",
  description: "Component with multiple sections",
  defaultOrder: ["Intro", "Main", "Outro"],
  sections: {
    Intro: {
      name: "Intro",
      description: "Introduction section",
      body: "Intro content here.",
    },
    Main: {
      name: "Main",
      description: "Main section",
      body: "Main content here.",
      requires: ["Alpha"],
    },
    Outro: {
      name: "Outro",
      description: "Outro section",
      body: "Outro content here.",
    },
  },
};

/**
 * Cycle triple: X -> Y -> Z -> X
 * Used to test cycle detection.
 */
const CycleX: Component = {
  name: "CycleX",
  category: "quality",
  description: "First part of cycle triple",
  sections: {
    Default: {
      name: "Default",
      description: "CycleX default",
      body: "CycleX body.",
      requires: [{ component: "CycleY", section: "Default" }],
    },
  },
};

const CycleY: Component = {
  name: "CycleY",
  category: "quality",
  description: "Second part of cycle triple",
  sections: {
    Default: {
      name: "Default",
      description: "CycleY default",
      body: "CycleY body.",
      requires: [{ component: "CycleZ", section: "Default" }],
    },
  },
};

const CycleZ: Component = {
  name: "CycleZ",
  category: "quality",
  description: "Third part of cycle triple (closes loop)",
  sections: {
    Default: {
      name: "Default",
      description: "CycleZ default",
      body: "CycleZ body.",
      requires: [{ component: "CycleX", section: "Default" }],
    },
  },
};

/**
 * Fixture registry without cycles — for validation tests.
 */
export const fixtureRegistryClean: Readonly<Record<string, Component>> = {
  [Alpha.name]: Alpha,
  [Beta.name]: Beta,
  [Gamma.name]: Gamma,
  [MultiSection.name]: MultiSection,
};

/**
 * Complete fixture registry including cycles — exported for test consumption.
 */
export const fixtureRegistry: Readonly<Record<string, Component>> = {
  [Alpha.name]: Alpha,
  [Beta.name]: Beta,
  [Gamma.name]: Gamma,
  [MultiSection.name]: MultiSection,
  [CycleX.name]: CycleX,
  [CycleY.name]: CycleY,
  [CycleZ.name]: CycleZ,
};
