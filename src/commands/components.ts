import { defineCommand } from "citty";
import { consola } from "consola";
import { relative } from "path";
import { resolveComponents } from "../utils/resolve-components";

export const componentsCommand = defineCommand({
  meta: {
    name: "components",
    description: "List available JDI components and their resolution sources",
  },
  async run() {
    const cwd = process.cwd();
    const components = await resolveComponents(cwd);

    consola.info("Available Components");
    consola.info("\u2500".repeat(60));

    for (const comp of components) {
      const source = comp.source === "project" ? "project" : comp.source === "user" ? "~/.software-teams" : "built-in";
      consola.info(`  <JDI:${comp.name} />  [${source}]  ${relative(cwd, comp.path)}`);
    }

    consola.info("");
    consola.info("Resolution order: project > user (~/.software-teams) > built-in");
  },
});
