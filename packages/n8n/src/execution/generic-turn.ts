import type { NodeEnvelope } from "@websitelabs/software-teams";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isValidToolName } = require("@websitelabs/software-teams") as {
  isValidToolName: (value: string) => boolean;
};

export type GenericToolPolicy = "readOnly" | "repositoryWrite" | "agentSpec" | "custom";

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"] as const;
const REPOSITORY_WRITE_TOOLS = [
  ...READ_ONLY_TOOLS,
  "Write",
  "Edit",
  "Bash(git:*)",
  "Bash(bun:*)",
  "Bash(npm:*)",
] as const;

/**
 * Resolve the generic node's tool policy.
 *
 * `undefined` means an operator deliberately selected Agent Spec, so the
 * specialist's own frontmatter is authoritative. Every other mode returns a
 * concrete allowlist that replaces the spec list. This is what makes
 * read-only a restriction rather than a label on a permissive process.
 */
export function resolveToolPolicy(
  policy: GenericToolPolicy,
  customTools: string,
): string[] | undefined {
  if (policy === "agentSpec") return undefined;
  if (policy === "readOnly") return [...READ_ONLY_TOOLS];
  if (policy === "repositoryWrite") return [...REPOSITORY_WRITE_TOOLS];

  const tools = customTools
    .split(/[\n,]/)
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (tools.length === 0) throw new Error("Custom Tools must contain at least one tool");

  const unique = [...new Set(tools)];
  for (const tool of unique) {
    const base = /^([A-Za-z][A-Za-z0-9]*)(?:\(.*\))?$/.exec(tool)?.[1] ?? tool;
    if (!isValidToolName(base)) throw new Error(`Unknown Claude Code tool "${tool}"`);
    if (base === "Agent") {
      throw new Error("Nested Agent spawning is not available inside an n8n turn");
    }
  }
  return unique;
}

export function parseOutputSchema(raw: string): Record<string, unknown> {
  if (raw.length > 20_000) throw new Error("Output Schema must be 20000 characters or fewer");

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Output Schema must be valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Output Schema must be a JSON object");
  }

  const schema = value as Record<string, unknown>;
  if (schema["type"] !== "object") throw new Error('Output Schema root type must be "object"');
  const unsupported = ["oneOf", "allOf", "anyOf"].find((key) => key in schema);
  if (unsupported) {
    throw new Error(
      `Output Schema cannot use top-level ${unsupported}; Claude StructuredOutput rejects top-level schema combinators`,
    );
  }
  return schema;
}

/** Build an agent handoff without throwing away the original ticket context. */
export function buildGenericHandoff(
  upstream: NodeEnvelope,
  agentId: string,
  prompt: string,
): NodeEnvelope {
  return {
    correlationId: upstream.correlationId,
    agentId,
    status: "ok",
    input: {
      prompt,
      context: {
        ticketContext: upstream.input.context,
        previous: {
          agentId: upstream.agentId,
          status: upstream.status,
          result: upstream.result,
          artifacts: upstream.artifacts,
        },
      },
    },
    result: { text: "" },
    artifacts: [...upstream.artifacts],
    ...(upstream.budget ? { budget: { ...upstream.budget } } : {}),
    ...(upstream.audit ? { audit: [...upstream.audit] } : {}),
    ...(upstream.repo ? { repo: upstream.repo } : {}),
    ...(upstream.changeRef ? { changeRef: upstream.changeRef } : {}),
    ...(upstream.feedback ? { feedback: upstream.feedback } : {}),
    ...(upstream.hitlChannel ? { hitlChannel: upstream.hitlChannel } : {}),
    ...(upstream.sessionId ? { sessionId: upstream.sessionId } : {}),
  };
}

/**
 * Per-turn CLI cap after accounting for ticket-wide spend.
 * `requestedUsd` is a second, narrower brake; zero means no per-turn override.
 */
export function turnBudget(input: NodeEnvelope, requestedUsd: number): number | undefined {
  const perTurn = requestedUsd > 0 ? requestedUsd : undefined;
  if (!input.budget) return perTurn;

  const remaining = Math.max(0, input.budget.limitUsd - input.budget.spentUsd);
  return perTurn === undefined ? remaining : Math.min(remaining, perTurn);
}

/** Append cumulative cost and a deliberately non-secret execution event. */
export function applyTurnAccounting(
  result: NodeEnvelope,
  input: NodeEnvelope,
  options: {
    readonly policy: GenericToolPolicy;
    readonly tools: readonly string[] | undefined;
    readonly permissionMode: "dontAsk";
    readonly now?: string;
  },
): NodeEnvelope {
  const costUsd = result.usage?.costUsd ?? 0;
  const budget = input.budget
    ? {
        limitUsd: input.budget.limitUsd,
        spentUsd: Number((input.budget.spentUsd + costUsd).toFixed(6)),
      }
    : undefined;
  const details: Record<string, string | number | boolean | string[]> = {
    permissionMode: options.permissionMode,
    toolPolicy: options.policy,
    allowedTools: options.tools ? [...options.tools] : ["agent-spec"],
    costUsd,
    turns: result.usage?.turns ?? 0,
  };

  return {
    ...result,
    ...(budget ? { budget } : {}),
    audit: [
      ...(input.audit ?? []),
      {
        at: options.now ?? new Date().toISOString(),
        actor: result.agentId,
        action: "claude-turn",
        status: result.status,
        details,
      },
    ],
  };
}

export function resumePolicyFromAudit(input: NodeEnvelope): {
  policy: GenericToolPolicy;
  tools: string[] | undefined;
} {
  const event = [...(input.audit ?? [])]
    .reverse()
    .find((candidate) => candidate.action === "claude-turn");
  const rawPolicy = event?.details?.["toolPolicy"];
  const policy: GenericToolPolicy =
    rawPolicy === "repositoryWrite" || rawPolicy === "agentSpec" || rawPolicy === "custom"
      ? rawPolicy
      : "readOnly";
  const allowed = event?.details?.["allowedTools"];
  const tools = Array.isArray(allowed) && !allowed.includes("agent-spec")
    ? allowed.filter((tool): tool is string => typeof tool === "string")
    : policy === "agentSpec"
      ? undefined
      : policy === "repositoryWrite"
        ? resolveToolPolicy(policy, "")
        : resolveToolPolicy("readOnly", "");
  return { policy, tools };
}

export function buildBudgetExhaustedEnvelope(
  input: NodeEnvelope,
  agentId: string,
  prompt: string,
  now = new Date().toISOString(),
): NodeEnvelope {
  return {
    ...input,
    agentId,
    status: "needs-input",
    input: { ...input.input, prompt },
    result: {
      text:
        `Ticket budget exhausted (${input.budget?.spentUsd.toFixed(2)} of ` +
        `${input.budget?.limitUsd.toFixed(2)} USD estimated). Increase the ticket budget to continue.`,
    },
    audit: [
      ...(input.audit ?? []),
      {
        at: now,
        actor: agentId,
        action: "claude-turn-skipped",
        status: "needs-input",
        details: {
          reason: "ticket-budget-exhausted",
          limitUsd: input.budget?.limitUsd ?? 0,
          spentUsd: input.budget?.spentUsd ?? 0,
        },
      },
    ],
  };
}
