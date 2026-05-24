/**
 * Shared provider types and normalised tool-use envelope.
 *
 * These types are the contract every Phase 1+2 provider implements against.
 * Do NOT import provider-specific SDKs here — keep this module side-effect-free.
 */

// ---------------------------------------------------------------------------
// Core scalar types
// ---------------------------------------------------------------------------

export type Provider = "anthropic" | "openai" | "xai" | "moonshot";
export type ModelTier = "large" | "medium" | "small";

// ---------------------------------------------------------------------------
// Resolved profile
// ---------------------------------------------------------------------------

/** Produced by `resolveAgentProfile` in providers/config.ts (T4). */
export interface ResolvedProfile {
  provider: Provider;
  /** The tier requested by the caller / config (before collapse aliasing). */
  modelTier: ModelTier;
  /** Concrete provider model ID, post-tier-mapping. */
  model: string;
}

// ---------------------------------------------------------------------------
// Dispatcher option types
// ---------------------------------------------------------------------------

export interface SpawnAgentOptions {
  /** Logical agent name, e.g. "planner", "programmer". */
  agent: string;
  prompt: string;
  cwd?: string;
  /** Anthropic-Code-CLI semantics; mapped per provider in each SpawnProvider. */
  allowedTools?: string[];
  /** "bypassPermissions" → skip tool-call prompts; any other value is a no-op. */
  permissionMode?: string;
}

export interface SpawnAgentResult {
  exitCode: number;
  response: string;
}

// ---------------------------------------------------------------------------
// Per-provider spawn signature
// ---------------------------------------------------------------------------

/**
 * Every provider function must satisfy this type.
 * The dispatcher resolves the model before calling; the provider never
 * re-reads config.
 */
export type SpawnProvider = (
  prompt: string,
  opts: {
    cwd?: string;
    allowedTools?: string[];
    model: string;
    permissionMode?: string;
  },
) => Promise<SpawnAgentResult>;

// ---------------------------------------------------------------------------
// Normalised tool-use envelope (R-03 mitigation)
// ---------------------------------------------------------------------------

/** A single tool invocation request from the model. */
export interface NormalisedToolCall {
  /** Provider-supplied call id. */
  id: string;
  /** Tool name as declared in allowedTools. */
  name: string;
  /** Parsed JSON arguments object. */
  args: unknown;
}

/** The result of executing a tool call. */
export interface NormalisedToolResult {
  /** Matches the call id from NormalisedToolCall. */
  id: string;
  /** Serialised tool output. */
  content: string;
  isError?: boolean;
}

/** Tool definition passed to a provider's tools array. */
export interface NormalisedToolDef {
  name: string;
  description: string;
  /** JSON Schema object for the tool's input. */
  inputSchema: object;
}
