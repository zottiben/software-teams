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
  updateGitHubComment,
  reactToComment,
  formatJediComment,
  formatErrorComment,
  fetchCommentThread,
  buildConversationContext,
} from "../utils/github";

type JediCommand = "plan" | "implement" | "quick" | "review" | "feedback" | "ping";

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
  // Strip "Hey Jedi" prefix (case-insensitive)
  const match = comment.match(/hey\s+jedi\s+(.+)/is);
  if (!match) {
    // No "Hey Jedi" prefix — if this is a follow-up in an existing conversation,
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
  if (lower.startsWith("ping") || lower.startsWith("status")) {
    return { command: "ping", description: "", clickUpUrl: null, fullFlow: false, isFeedback: false };
  }
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

  // If there's an existing conversation, treat ambiguous "Hey Jedi" messages as feedback
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
    description: "GitHub Action entry point — parse 'Hey Jedi' comment and run workflow",
  },
  args: {
    comment: {
      type: "positional",
      description: "The raw comment body containing 'Hey Jedi' mention",
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
      consola.error("Could not parse 'Hey Jedi' intent from comment");
      process.exit(1);
    }

    consola.info(
      `Parsed intent: ${intent.isFeedback ? "feedback on previous" : intent.command}${intent.fullFlow ? " (full flow)" : ""}`,
    );

    // React with eyes to indicate processing
    if (repo && commentId) {
      await reactToComment(repo, commentId, "eyes").catch(() => {});
    }

    // Post a thinking placeholder comment
    const commandLabel = intent.isFeedback ? "feedback" : intent.command;
    let placeholderCommentId: number | null = null;
    if (repo && issueNumber) {
      const thinkingBody = `<h3>🧠 Jedi <sup>thinking</sup></h3>\n\n---\n\n_Working on it..._`;
      placeholderCommentId = await postGitHubComment(repo, issueNumber, thinkingBody).catch(() => null);
    }

    // Ping: quick framework status check — no Claude invocation needed
    if (intent.command === "ping") {
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      const frameworkExists = existsSync(join(cwd, ".jdi/framework"));
      const claudeMdExists = existsSync(join(cwd, ".claude/CLAUDE.md"));
      const stateExists = existsSync(join(cwd, ".jdi/config/state.yaml"));
      const learningsExists = existsSync(join(cwd, ".jdi/persistence/learnings.md"));

      let version = "unknown";
      try {
        const pkgPath = join(cwd, "node_modules/@benzotti/jedi/package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(await Bun.file(pkgPath).text());
          version = pkg.version;
        }
      } catch {}

      const statusBody = [
        `**Framework Status**`,
        ``,
        `| Component | Status |`,
        `|-----------|--------|`,
        `| Framework files | ${frameworkExists ? "found" : "missing"} |`,
        `| CLAUDE.md | ${claudeMdExists ? "found" : "missing"} |`,
        `| State config | ${stateExists ? "found" : "missing"} |`,
        `| Learnings | ${learningsExists ? "found" : "missing"} |`,
        `| Version | \`${version}\` |`,
      ].join("\n");

      const finalBody = formatJediComment("ping", statusBody);

      if (repo && placeholderCommentId) {
        await updateGitHubComment(repo, placeholderCommentId, finalBody).catch((err) => {
          consola.error("Failed to update ping comment:", err);
        });
      } else if (repo && issueNumber) {
        await postGitHubComment(repo, issueNumber, finalBody).catch((err) => {
          consola.error("Failed to post ping comment:", err);
        });
      } else {
        console.log(finalBody);
      }

      if (repo && commentId) {
        await reactToComment(repo, commentId, "+1").catch(() => {});
      }
      return;
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
        `IMPORTANT: Always be conversational. If the user asks a question, ANSWER IT FIRST before taking any action.`,
        `Explain your reasoning, then describe what you'll do (if anything), then do it.`,
        `Never silently make changes without explaining why.`,
        ``,
        `- If the feedback is a **question** ("why did you...", "what about...", "can you explain..."), answer it conversationally first. If the answer implies a change is needed, explain that and then apply it.`,
        `- If the feedback is an **approval** ("approved", "lgtm", "looks good", "ship it"), finalise the current work — commit all outstanding changes and push to the current branch. Do NOT ask — just do it.`,
        `- If the feedback is a **refinement** ("change task 2", "use a different approach", "add error handling"), explain what you're changing and why, then apply the changes. Present an updated summary with the full updated plan in a collapsible block:`,
        `   <details>`,
        `   <summary>View full plan</summary>`,
        `   `,
        `   [full updated plan content here as markdown]`,
        `   `,
        `   </details>`,
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
            `## Scope Rules`,
            `IMPORTANT: Only plan what was explicitly requested. Do NOT add extras like testing, linting, formatting, CI, or tooling unless the user asked for them.`,
            `If something is ambiguous, ask — do not guess.`,
            `NEVER use time estimates (minutes, hours, etc). Use t-shirt sizes: S, M, L. This is mandatory.`,
            ``,
            `## Learnings`,
            `Before planning, read .jdi/persistence/learnings.md and .jdi/framework/learnings/ if they exist. Apply any team preferences found.`,
            ``,
            `## Response Format`,
            `Follow the planning workflow in your spec to write plan files. Then respond with EXACTLY this structure (no deviations, no meta-commentary like "You are now active as..." or "Plan created"):`,
            ``,
            `1-2 sentence summary of the approach.`,
            ``,
            `<details>`,
            `<summary>View full plan</summary>`,
            ``,
            `## {Plan Name}`,
            ``,
            `**Overall size:** {S|M|L}`,
            ``,
            `### Tasks`,
            ``,
            `| Task | Name | Size | Type | Wave |`,
            `|------|------|------|------|------|`,
            `| T1 | {name} | {S|M|L} | auto | 1 |`,
            ``,
            `### T1 — {Task Name}`,
            `**Objective:** {what this achieves}`,
            ``,
            `**Steps:**`,
            `1. {step}`,
            ``,
            `**Done when:** {completion criterion}`,
            ``,
            `---`,
            `(repeat for each task)`,
            ``,
            `### Verification`,
            `- [ ] {check 1}`,
            `- [ ] {check 2}`,
            ``,
            `</details>`,
            ``,
            `**Optional additions** — not included in this plan:`,
            `1. {suggestion}`,
            `2. {suggestion}`,
            ``,
            `Any changes before implementation?`,
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
            `Follow the implement-plan orchestration.`,
            ``,
            `## Auto-Commit`,
            `You are running inside a GitHub Action on a PR branch. After implementing all changes:`,
            `1. Stage all changed files with \`git add\` (only files you changed — NOT .jdi/ or .claude/)`,
            `2. Commit with a conventional commit message (e.g. "feat: implement X")`,
            `3. Push to the current branch with \`git push\``,
            `Do NOT ask the user — just commit and push. The user will review the PR diff directly.`,
            `Present a summary of what was implemented and committed.`,
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
            `Keep changes minimal and focused.`,
            ``,
            `## Auto-Commit`,
            `You are running inside a GitHub Action on a PR branch. After making changes:`,
            `1. Stage all changed files with \`git add\` (only files you changed — NOT .jdi/ or .claude/)`,
            `2. Commit with a conventional commit message`,
            `3. Push to the current branch with \`git push\``,
            `Do NOT ask the user — just commit and push. Present what you changed.`,
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
    let fullResponse = "";
    try {
      const { exitCode, response } = await spawnClaude(prompt, {
        cwd,
        permissionMode: "bypassPermissions",
      });
      fullResponse = response;
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
          `Follow the implement-plan orchestration.`,
          ``,
          `## Auto-Commit`,
          `You are running inside a GitHub Action on a PR branch. After implementing all changes:`,
          `1. Stage all changed files with \`git add\` (only files you changed — NOT .jdi/ or .claude/)`,
          `2. Commit with a conventional commit message (e.g. "feat: implement X")`,
          `3. Push to the current branch with \`git push\``,
          `Do NOT ask the user — just commit and push. Present a summary of what was implemented and committed.`,
        ].join("\n");

        const implResult = await spawnClaude(implementPrompt, {
          cwd,
          permissionMode: "bypassPermissions",
        });
        if (implResult.exitCode !== 0) {
          success = false;
        }
        // Append implementation response
        if (implResult.response) {
          fullResponse += "\n\n---\n\n" + implResult.response;
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

    // Update placeholder comment with final response (or post new if placeholder failed)
    if (repo && issueNumber) {
      const actionLabel = intent.isFeedback ? "feedback" : intent.command;
      let commentBody: string;

      if (success && fullResponse) {
        commentBody = formatJediComment(actionLabel, fullResponse);
      } else if (!success) {
        commentBody = formatErrorComment(actionLabel, "Check workflow logs for details.");
      } else {
        commentBody = formatJediComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);
      }

      if (placeholderCommentId) {
        await updateGitHubComment(repo, placeholderCommentId, commentBody).catch((err) => {
          consola.error("Failed to update result comment:", err);
        });
      } else {
        await postGitHubComment(repo, issueNumber, commentBody).catch((err) => {
          consola.error("Failed to post result comment:", err);
        });
      }
    }

    // React with result
    if (repo && commentId) {
      const reaction = success ? "+1" : "-1";
      await reactToComment(repo, commentId, reaction).catch(() => {});
    }

    if (!success) process.exit(1);
  },
});
