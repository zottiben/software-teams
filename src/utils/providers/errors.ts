/**
 * Provider error hierarchy.
 *
 * Each class names the offending key and the fix so callers get actionable
 * messages at throw time. All errors extend `ProviderError` so callers can
 * catch the whole family with a single instanceof check.
 */

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Required env var for the resolved provider is not set. */
export class MissingApiKeyError extends ProviderError {
  constructor(envVar: string, provider: string) {
    super(
      `[providers] Missing env var '${envVar}' for provider '${provider}'. Set it before running.`,
    );
  }
}

/** Profile names a provider not in the catalogue. */
export class UnknownProviderError extends ProviderError {
  constructor(provider: string) {
    super(
      `[providers] Unknown provider '${provider}'. Expected: anthropic, openai, xai, moonshot.`,
    );
  }
}

/** `model_tier` is not one of large/medium/small. */
export class UnknownTierError extends ProviderError {
  constructor(tier: string) {
    super(
      `[providers] Unknown model_tier '${tier}'. Expected: large, medium, small.`,
    );
  }
}

/** Dispatcher cannot resolve the agent via profile or frontmatter. */
export class UnknownAgentError extends ProviderError {
  constructor(agent: string, profile: string) {
    super(
      `[providers] Agent '${agent}' not found in profile '${profile}' and has no model_tier in frontmatter.`,
    );
  }
}

/** Profile entry has an unrecognised shape (not bare string nor object). */
export class MalformedProfileError extends ProviderError {
  constructor(agent: string) {
    super(
      `[providers] Malformed profile entry for '${agent}': expected 'opus' or '{ provider, model_tier }'.`,
    );
  }
}

/**
 * Caller requested `tool_choice: 'required'` on Moonshot, which does not
 * support that mode.
 */
export class MoonshotToolChoiceError extends ProviderError {
  constructor() {
    super(
      `[providers] Moonshot does not support tool_choice='required'; use 'auto'.`,
    );
  }
}

/**
 * Provider slot exists in the catalogue but the implementation has not shipped
 * yet. Thrown by stub registry entries for OpenAI / xAI / Moonshot until
 * T6 / T9 land.
 */
export class ProviderNotImplementedError extends ProviderError {
  constructor(provider: string, envVar: string, installHint: string) {
    super(
      `[providers] Provider '${provider}' is not yet implemented. ` +
        `Set '${envVar}' and install '${installHint}' when it ships (see Phase 1/2 tasks).`,
    );
  }
}
