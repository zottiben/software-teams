import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { detectProjectType } from "../utils/detect-project";
import { readAdapter } from "../utils/adapter";
import { spawnClaude } from "../utils/claude";
import { createStorage } from "../storage";
import { loadPersistedState, savePersistedState } from "../utils/storage-lifecycle";
import { extractClickUpId, fetchClickUpTicket, formatTicketAsContext } from "../utils/clickup";
import {
  postGitHubComment,
  reactToComment,
  formatResultComment,
  fetchCommentThread,
  buildConversationContext,
} from "../utils/github";

type JediCommand = "plan" | "implement" | "quick" | "review" | "feedback";

interface ParsedIntent {
  command: JediCommand;
  description: string;
  clickUpUrl: string | null;
  fullFlow: boolean;
  isFeedback: boolean;
}

function parseComment(
  comment: string,
  isFollowUp: boolean,
): ParsedIntent | null {
  // Strip @jedi prefix
  const match = comment.match(/@jedi\s+(.+)/is);
  if (!match) {
    // No @jedi prefix — if this is a follow-up in an existing conversation,
    // treat the entire comment as feedback
    if (isFollowUp) {
      return {
        command: "plan", // will be overridden by conversation context
        description: comment.trim(),
        clickUpUrl: null,
        fullFlow: false,
        isFeedback: true,
      };
    }
    return null;
  }

  const body = match[1].trim();

  // Extract ClickUp URL if present
  const clickUpMatch = body.match(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i);
  const clickUpUrl = clickUpMatch ? clickUpMatch[1] : null;

  // Remove the URL from the body for cleaner description
  const description = body
    .replace(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = body.toLowerCase();

  // Explicit commands always start a new workflow
  if (lower.startsWith("plan ")) {
    return { command: "plan", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }
  if (lower.startsWith("implement")) {
    return { command: "implement", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }
  if (lower.startsWith("quick ")) {
    return { command: "quick", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }
  if (lower.startsWith("review")) {
    return { command: "review", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }
  if (lower.startsWith("feedback")) {
    return { command: "feedback", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }

  // "do" triggers full flow (plan + implement) if ClickUp URL present
  if (lower.startsWith("do ")) {
    if (clickUpUrl) {
      return { command: "plan", description, clickUpUrl, fullFlow: true, isFeedback: false };
    }
    return { command: "quick", description, clickUpUrl, fullFlow: false, isFeedback: false };
  }

  // "approved" / "lgtm" / "looks good" — approval feedback
  if (/^(approved?|lgtm|looks?\s*good|ship\s*it)/i.test(lower)) {
    return {
      command: "plan",
      description: body,
      clickUpUrl: null,
      fullFlow: false,
      isFeedback: true,
    };
  }

  // If there's an existing conversation, treat ambiguous @jedi messages as feedback
  if (isFollowUp) {
    return {
      command: "plan",
      description: body,
      clickUpUrl: null,
      fullFlow: false,
      isFeedback: true,
    };
  }

  // Default: treat as new plan request
  return { command: "plan", description, clickUpUrl, fullFlow: false, isFeedback: false };
}

export const actionCommand = defineCommand({
  meta: {
    name: "action",
    description: "GitHub Action entry point — parse @jedi comment and run workflow",
  },
  args: {
    comment: {
      type: "positional",
      description: "The raw comment body containing @jedi mention",
      required: true,
    },
    "comment-id": {
      type: "string",
      description: "GitHub comment ID for reactions",
    },
    "pr-number": {
      type: "string",
      description: "PR number (if triggered from a PR)",
    },
    "issue-number": {
      type: "string",
      description: "Issue number (if triggered from an issue)",
    },
    repo: {
      type: "string",
      description: "Repository in owner/repo format",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
    const commentId = args["comment-id"] ? Number(args["comment-id"]) : null;
    const issueNumber = Number(args["pr-number"] ?? args["issue-number"] ?? 0);

    // Fetch comment thread to detect if this is a follow-up conversation
    let conversationHistory = "";
    let isFollowUp = false;
    if (repo && issueNumber) {
      const thread = await fetchCommentThread(repo, issueNumber);
      const context = buildConversationContext(
        thread,
        commentId ?? 0,
      );
      conversationHistory = context.history;
      isFollowUp = context.isFollowUp;

      if (isFollowUp) {
        consola.info(
          `Continuing conversation (${context.previousJediRuns} previous Jedi run(s))`,
        );
      }
    }

    // Parse intent — pass isFollowUp so ambiguous messages become feedback
    const intent = parseComment(args.comment, isFollowUp);
    if (!intent) {
      consola.error("Could not parse @jedi intent from comment");
      process.exit(1);
    }

    consola.info(
      `Parsed intent: ${intent.isFeedback ? "feedback on previous" : intent.command}${intent.fullFlow ? " (full flow)" : ""}`,
    );

    // React with eyes to indicate processing
    if (repo && commentId) {
      await reactToComment(repo, commentId, "eyes").catch(() => {});
    }

    // Load persisted state via storage
    const storage = await createStorage(cwd);
    const { learningsPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

    // Fetch ClickUp ticket context if URL present
    let ticketContext = "";
    if (intent.clickUpUrl) {
      const taskId = extractClickUpId(intent.clickUpUrl);
      if (taskId) {
        consola.info(`Fetching ClickUp ticket: ${taskId}`);
        const ticket = await fetchClickUpTicket(taskId);
        if (ticket) {
          ticketContext = formatTicketAsContext(ticket);
          consola.success(`Loaded ticket: ${ticket.name}`);
        }
      }
    }

    // Build project context
    const projectType = await detectProjectType(cwd);
    const adapter = await readAdapter(cwd);
    const techStack = adapter?.tech_stack
      ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
      : projectType;

    const contextLines = [
      `## Project Context`,
      `- Type: ${projectType}`,
      `- Tech stack: ${techStack}`,
      `- Working directory: ${cwd}`,
    ];

    if (learningsPath) {
      contextLines.push(`- Learnings: ${learningsPath}`);
    }
    if (codebaseIndexPath) {
      contextLines.push(`- Codebase index: ${codebaseIndexPath}`);
    }
    if (ticketContext) {
      contextLines.push(``, ticketContext);
    }

    const baseProtocol = resolve(cwd, ".jdi/framework/components/meta/AgentBase.md");

    // Build prompt based on whether this is feedback or a new command
    let prompt: string;

    if (intent.isFeedback) {
      // ── Feedback / follow-up on existing conversation ──
      prompt = [
        `Read ${baseProtocol} for the base agent protocol.`,
        ``,
        ...contextLines,
        ``,
        conversationHistory,
        ``,
        `## Current Feedback`,
        `The user has provided feedback on previous Jedi work:`,
        ``,
        `> ${intent.description}`,
        ``,
        `## Instructions`,
        `Review the previous conversation above. The user is iterating on work Jedi already started.`,
        ``,
        `- If the feedback is an **approval** ("approved", "lgtm", "looks good", "ship it"), finalise the current work — create commits and/or a PR as appropriate.`,
        `- If the feedback is a **refinement** ("change task 2", "use a different approach", "add error handling"), apply the requested changes to the existing plan or implementation. Present an updated summary when done.`,
        `- If the feedback is a **question**, answer it with full context from the conversation.`,
        ``,
        `Read state.yaml and any existing plan files to understand what was previously done. Apply changes incrementally — do not restart from scratch.`,
      ].join("\n");
    } else {
      // ── New command ──
      const agentSpec = resolve(cwd, `.jdi/framework/agents/jdi-planner.md`);

      // Include conversation history as context even for new commands,
      // so the agent is aware of any prior work on this issue
      const historyBlock = conversationHistory
        ? `\n${conversationHistory}\n\nThe above is prior conversation on this issue for context.\n`
        : "";

      switch (intent.command) {
        case "plan":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            `You are jdi-planner. Read ${agentSpec} for your full specification.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Create an implementation plan for: ${intent.description}`,
            ticketContext
              ? `\nUse the ClickUp ticket above as the primary requirements source.`
              : ``,
            ``,
            `Follow the planning workflow in your spec. Present the plan summary when complete and ask for feedback. The user will respond via another GitHub comment.`,
          ].join("\n");
          break;

        case "implement":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            `Read ${resolve(cwd, ".jdi/framework/components/meta/ComplexityRouter.md")} for complexity routing rules.`,
            `Read ${resolve(cwd, ".jdi/framework/components/meta/AgentTeamsOrchestration.md")} for Agent Teams orchestration (if needed).`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Execute the current implementation plan. Read state.yaml for the active plan path.`,
            `Follow the implement-plan orchestration. Present a summary when complete and ask for feedback.`,
          ].join("\n");
          break;

        case "quick":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Make this quick change: ${intent.description}`,
            `Keep changes minimal and focused. Commit when done. Present what you changed.`,
          ].join("\n");
          break;

        case "review":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Review the current PR. Post line-level review comments via gh api.`,
          ].join("\n");
          break;

        case "feedback":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Address PR feedback comments. Read comments via gh api, make changes, reply to each.`,
          ].join("\n");
          break;

        default:
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            intent.description,
          ].join("\n");
      }
    }

    // Execute
    let success = true;
    try {
      const { exitCode } = await spawnClaude(prompt, {
        cwd,
        permissionMode: "bypassPermissions",
      });
      if (exitCode !== 0) {
        success = false;
        consola.error(`Claude exited with code ${exitCode}`);
      }

      // If full flow, run implement after plan
      if (intent.fullFlow && success) {
        consola.info("Full flow: now running implement...");
        const implementPrompt = [
          `Read ${baseProtocol} for the base agent protocol.`,
          `Read ${resolve(cwd, ".jdi/framework/components/meta/ComplexityRouter.md")} for complexity routing rules.`,
          `Read ${resolve(cwd, ".jdi/framework/components/meta/AgentTeamsOrchestration.md")} for Agent Teams orchestration (if needed).`,
          ``,
          ...contextLines,
          ``,
          `## Task`,
          `Execute the most recently created implementation plan in .jdi/plans/.`,
          `Follow the implement-plan orchestration. Present a summary when complete.`,
        ].join("\n");

        const implResult = await spawnClaude(implementPrompt, {
          cwd,
          permissionMode: "bypassPermissions",
        });
        if (implResult.exitCode !== 0) {
          success = false;
        }
      }
    } catch (err) {
      success = false;
      consola.error("Execution failed:", err);
    }

    // Save updated state back to storage
    const saved = await savePersistedState(cwd, storage);
    if (saved.learningsSaved) consola.info("Learnings persisted to storage");
    if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

    // Post result comment
    if (repo && issueNumber) {
      const actionLabel = intent.isFeedback ? "feedback" : intent.command;
      const summary = success
        ? `Executed \`${actionLabel}\` successfully.${saved.learningsSaved ? " Learnings updated." : ""}`
        : `Execution of \`${actionLabel}\` failed. Check workflow logs for details.`;

      const commentBody = formatResultComment(actionLabel, success, summary);
      await postGitHubComment(repo, issueNumber, commentBody).catch((err) => {
        consola.error("Failed to post result comment:", err);
      });
    }

    // React with result
    if (repo && commentId) {
      const reaction = success ? "+1" : "-1";
      await reactToComment(repo, commentId, reaction).catch(() => {});
    }

    if (!success) process.exit(1);
  },
});
