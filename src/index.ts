#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { initCommand } from "./commands/init";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { statusCommand } from "./commands/status";
import { componentsCommand } from "./commands/components";
import { commitCommand } from "./commands/commit";
import { prCommand } from "./commands/pr";
import { reviewCommand } from "./commands/review";
import { feedbackCommand } from "./commands/feedback";
import { quickCommand } from "./commands/quick";
import { worktreeCommand } from "./commands/worktree";
import { worktreeRemoveCommand } from "./commands/worktree-remove";
import { planReviewCommand } from "./commands/plan-review";
import { planApproveCommand } from "./commands/plan-approve";
import { actionCommand } from "./commands/action";
import { setupActionCommand } from "./commands/setup-action";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "jdi",
    version: pkg.version,
    description: pkg.description,
  },
  subCommands: {
    init: initCommand,
    plan: planCommand,
    implement: implementCommand,
    status: statusCommand,
    components: componentsCommand,
    commit: commitCommand,
    pr: prCommand,
    review: reviewCommand,
    feedback: feedbackCommand,
    quick: quickCommand,
    worktree: worktreeCommand,
    "worktree-remove": worktreeRemoveCommand,
    "plan-review": planReviewCommand,
    "plan-approve": planApproveCommand,
    action: actionCommand,
    "setup-action": setupActionCommand,
  },
});

runMain(main);
