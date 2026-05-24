/**
 * Shared OpenAI-compatible spawn implementation.
 *
 * Used by openai.ts (native OpenAI) and will be reused by xai.ts + moonshot.ts
 * (T9) which are thin wrappers that set baseURL and provider-specific quirks.
 *
 * Streaming text deltas are written to process.stdout for UX parity with
 * spawnClaude. Tool-use translation (NormalisedToolCall <-> OpenAI tool_calls)
 * is implemented, but TOOL EXECUTION IS NOT supported in v1 — if the model
 * returns tool_calls the loop returns exitCode 1 with a clear error message.
 * T8 must mock this path. T9 can reuse this file verbatim.
 *
 * Tool execution limitation:
 * The framework currently relies on Claude Code's native tool execution runtime
 * (Read, Bash, Edit, etc.). Replicating that runtime for direct-SDK providers is
 * out of scope for Phase 1. Provider-routed agents should be largely self-contained
 * (planner, researcher, verifier, committer, qa-tester in review mode). Do NOT
 * route programmer agents to OpenAI/xAI/Moonshot until tool execution lands.
 */

import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import { redact } from "../redact.ts";
import { MissingApiKeyError } from "./errors.ts";
import type {
  NormalisedToolCall,
  NormalisedToolDef,
  SpawnAgentResult,
} from "./types.ts";

/** Maximum tool-use round-trips before bailing (prevents runaway loops). */
const MAX_TOOL_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Tool translation helpers — NormalisedToolDef <-> OpenAI shape
// ---------------------------------------------------------------------------

/**
 * Convert NormalisedToolDef array to the OpenAI `tools` parameter format.
 *
 * Exported so xai.ts / moonshot.ts (T9) can reuse without duplication.
 */
export function toOpenAITools(defs: NormalisedToolDef[]): ChatCompletionTool[] {
  return defs.map((def) => ({
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Convert the OpenAI `tool_calls` array from a streamed response message
 * to our normalised envelope.
 *
 * `arguments` arrives as a raw JSON string from the API — parse it here so
 * callers always see a plain object in `args`.
 *
 * Exported so xai.ts / moonshot.ts (T9) can reuse without duplication.
 */
export function fromOpenAIToolCalls(
  toolCalls: NonNullable<
    ChatCompletionChunk["choices"][number]["delta"]["tool_calls"]
  >,
): NormalisedToolCall[] {
  return toolCalls.map((tc) => {
    let args: unknown = {};
    try {
      args = JSON.parse(tc.function?.arguments ?? "{}");
    } catch {
      // Malformed JSON from the model — keep empty object, let caller handle.
      args = {};
    }
    return {
      id: tc.id ?? "",
      name: tc.function?.name ?? "",
      args,
    };
  });
}

/**
 * Build the `allowedTools` string list into a NormalisedToolDef array.
 *
 * In Phase 1, the `allowedTools` from SpawnAgentOptions are Anthropic-Code-CLI
 * tool names (e.g. "Bash", "Read", "Edit"). We cannot execute these natively;
 * we translate them into stub tool definitions so the OpenAI API accepts the
 * tools array, but if the model calls one we surface the limitation error.
 *
 * An empty / undefined allowedTools list → no tools parameter sent (saves
 * tokens and avoids the model attempting tool calls).
 */
function buildToolDefs(allowedTools?: string[]): NormalisedToolDef[] {
  if (!allowedTools || allowedTools.length === 0) return [];
  return allowedTools.map((name) => ({
    name,
    description: `${name} tool (Anthropic-Code-CLI semantics; execution not supported on this provider in v1).`,
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Tool input" },
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Core streaming loop
// ---------------------------------------------------------------------------

/**
 * Options for spawnOpenAICompat — the shared implementation.
 *
 * `apiKey` and `baseURL` are passed in by the provider wrapper so this
 * function stays provider-agnostic.
 */
export interface OpenAICompatOptions {
  /** Pre-resolved model ID (dispatcher sets this — never re-read config here). */
  model: string;
  /** Provider API key — already validated before call. */
  apiKey: string;
  /** Optional base URL override for xAI / Moonshot compatibility. */
  baseURL?: string;
  /** Working directory (informational; not used for tool execution in v1). */
  cwd?: string;
  /** Anthropic-Code-CLI tool names to translate to OpenAI function definitions. */
  allowedTools?: string[];
  /**
   * Provider name for error messages and logging.
   * e.g. "openai", "xai", "moonshot"
   */
  providerLabel: string;
  /**
   * Optional temperature override for providers with fixed temperature
   * requirements (e.g. Moonshot kimi-k2 series: 0.6 for standard, 1.0 for
   * thinking variants). When omitted the API default is used.
   */
  temperature?: number;
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 *
 * Text deltas are written to process.stdout.
 * Tool calls are translated to NormalisedToolCall but NOT executed (v1
 * limitation — see module docstring). If the model returns tool_calls,
 * the function returns exitCode 1 with a descriptive error message.
 *
 * Loop cap: MAX_TOOL_ITERATIONS (10) iterations before bailing.
 */
export async function spawnOpenAICompat(
  prompt: string,
  opts: OpenAICompatOptions,
): Promise<SpawnAgentResult> {
  const { model, apiKey, baseURL, allowedTools, providerLabel, temperature } = opts;

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const toolDefs = buildToolDefs(allowedTools);
  const openAITools = toolDefs.length > 0 ? toOpenAITools(toolDefs) : undefined;

  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  let accumulatedResponse = "";
  let iteration = 0;

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const createParams = {
      model,
      stream: true as const,
      messages,
      ...(openAITools ? { tools: openAITools } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    let stream: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      stream = await client.chat.completions.create(createParams);
    } catch (err) {
      // Surface a clean error when the model name is rejected by the provider
      // so users know to update their tier mapping in providers/config.ts.
      if (
        err instanceof APIError &&
        (err.status === 404 ||
          (err as APIError & { code?: string }).code === "model_not_found")
      ) {
        const hint =
          `[providers/${providerLabel}] Model '${model}' was rejected by the API (model_not_found). ` +
          `Update the tier mapping in src/utils/providers/config.ts to a valid model ID.`;
        throw new Error(hint);
      }
      throw err;
    }

    // Accumulate streamed content and tool_calls deltas.
    let chunkText = "";
    // tool_calls arrive fragmented across chunks; accumulate by index.
    const accumulatedToolCalls: Array<{
      id: string;
      name: string;
      arguments: string;
    }> = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Stream text to stdout (parity with spawnClaude's streaming UX).
      if (delta.content) {
        const safe = redact(delta.content);
        process.stdout.write(safe);
        chunkText += delta.content;
      }

      // Accumulate tool_calls deltas (index-based assembly).
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!accumulatedToolCalls[idx]) {
            accumulatedToolCalls[idx] = { id: "", name: "", arguments: "" };
          }
          if (tc.id) accumulatedToolCalls[idx].id = tc.id;
          if (tc.function?.name) accumulatedToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) {
            accumulatedToolCalls[idx].arguments += tc.function.arguments;
          }
        }
      }
    }

    accumulatedResponse += chunkText;

    // Check if the model requested tool calls.
    if (accumulatedToolCalls.length > 0) {
      // Translate to normalised envelope (for envelope correctness — T3 contract).
      const normalisedCalls: NormalisedToolCall[] = accumulatedToolCalls.map(
        (tc) => {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.arguments || "{}");
          } catch {
            args = {};
          }
          return { id: tc.id, name: tc.name, args };
        },
      );

      // V1 limitation: tool execution is not supported on direct-SDK providers.
      // The normalised envelope is correctly built above, but we cannot dispatch
      // Anthropic-Code-CLI tools (Read, Bash, Edit, etc.) from this runtime.
      // Surface a clear error so the user knows to use the anthropic provider
      // for agents that require tool execution (e.g. programmer).
      const toolNames = normalisedCalls.map((c) => c.name).join(", ");
      const errorMsg =
        `[providers/${providerLabel}] Tool execution is not supported for direct-SDK providers in v1. ` +
        `The model requested tools: [${toolNames}]. ` +
        `Use provider 'anthropic' for agents that require tool execution (e.g. programmer). ` +
        `Tool execution support for OpenAI/xAI/Moonshot is planned for a future release.`;

      process.stderr.write(`\n${errorMsg}\n`);
      return { exitCode: 1, response: errorMsg };
    }

    // No tool calls — text response is complete.
    if (chunkText) {
      process.stdout.write("\n");
    }

    return { exitCode: 0, response: accumulatedResponse };
  }

  // Reached iteration cap without a final text response.
  const capMsg =
    `[providers/${providerLabel}] Tool-use loop exceeded maximum iterations (${MAX_TOOL_ITERATIONS}). Aborting.`;
  process.stderr.write(`\n${capMsg}\n`);
  return { exitCode: 1, response: capMsg };
}

// ---------------------------------------------------------------------------
// API key validation helper
// ---------------------------------------------------------------------------

/**
 * Validate that the required env var is set, throwing MissingApiKeyError
 * immediately (before any network call) if not.
 *
 * Exported for reuse by xai.ts / moonshot.ts (T9).
 */
export function requireApiKey(envVar: string, provider: string): string {
  const key = process.env[envVar];
  if (!key) {
    throw new MissingApiKeyError(envVar, provider);
  }
  return key;
}
