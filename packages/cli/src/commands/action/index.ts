import { defineCommand } from "citty";
import { runCommand } from "./run";
import { resolveBranchCommand } from "./resolve-branch";
import { bootstrapCommand } from "./bootstrap";
import { fetchRulesCommand } from "./fetch-rules";
import { promoteRulesCommand } from "./promote-rules";
import { prunePlansCommand } from "./prune-plans";

export const actionCommand = defineCommand({
  meta: {
    name: "action",
    description: "GitHub Action commands — run workflows, bootstrap, manage rules",
  },
  subCommands: {
    run: runCommand,
    "resolve-branch": resolveBranchCommand,
    bootstrap: bootstrapCommand,
    "fetch-rules": fetchRulesCommand,
    "promote-rules": promoteRulesCommand,
    "prune-plans": prunePlansCommand,
  },
});
