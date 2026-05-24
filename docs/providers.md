# Provider Reference

Software Teams supports four LLM providers. This page is the canonical reference
for SDK packages, authentication, model tiers, capability quirks, and migration
guidance. For the short intro and env var table, see
[`README.md` — Provider Configuration](../README.md#provider-configuration).
For GitHub Actions wiring, see [`action/README.md`](../action/README.md).

---

## Providers at a glance

| Provider | SDK package | Env var | Base URL |
|----------|-------------|---------|----------|
| `anthropic` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` | (default) |
| `openai` | `openai` | `OPENAI_API_KEY` | (default) |
| `xai` | `openai` (OpenAI-compat) | `XAI_API_KEY` | `https://api.x.ai/v1` |
| `moonshot` | `openai` (OpenAI-compat) | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` |

---

## Tier → model mapping

Each agent resolves to a concrete model ID based on its tier and the selected
provider. The mapping table below is the authoritative source — it mirrors
`TIER_MODEL_MAP` in `src/utils/providers/config.ts`.

| Tier | anthropic | openai | xai | moonshot |
|------|-----------|--------|-----|----------|
| `large` | `claude-opus-4-7` | `gpt-4o` | `grok-4.3` | `kimi-k2.6` |
| `medium` | `claude-sonnet-4-5` | `gpt-4o-mini` | `grok-3-mini-beta` | `kimi-k2.5` |
| `small` | `claude-haiku-3-5` | `gpt-4o-mini` | `grok-3-mini-beta` | `kimi-k2.5` |

**Note on `small` tier:** OpenAI, xAI, and Moonshot have no distinct small
model. The dispatcher aliases `small` to the same model as `medium` and emits a
one-time INFO log per process:

```
[providers] tier 'small' on provider 'openai' resolves to gpt-4o-mini (same as medium)
```

This is not an error. Use `model_tier: medium` explicitly to silence the log.

---

## Per-provider details

### Anthropic

**SDK:** `@anthropic-ai/sdk` — SSE streaming via `client.messages.stream()`.
Tool use uses `tool_use` / `tool_result` content blocks (not the OpenAI
`tool_calls` shape). All 24 canonical agents default to this provider.

**Authentication:** Set `ANTHROPIC_API_KEY` in your environment or repo secrets.

**Supported tiers:** `large` (`claude-opus-4-7`), `medium` (`claude-sonnet-4-5`),
`small` (`claude-haiku-3-5`).

**Tool use:** Fully supported. This is the only provider that supports full tool
execution in v1 (see [v1 limitation](#v1-limitation-tool-execution) below).

**Config example:**

```yaml
models:
  profile: balanced
  profiles:
    balanced:
      programmer: { provider: anthropic, model_tier: large }
      planner: { provider: anthropic, model_tier: medium }
```

---

### OpenAI

**SDK:** `openai` npm package — SSE streaming via
`client.chat.completions.create({ stream: true })`. Tool use uses the OpenAI
`tools` / `tool_calls` shape.

**Authentication:** Set `OPENAI_API_KEY`.

**Supported tiers:** `large` (`gpt-4o`), `medium` and `small` (`gpt-4o-mini`).

**Known quirks:** None beyond the `small` alias (see above).

**Config example:**

```yaml
models:
  profile: balanced
  profiles:
    balanced:
      planner: { provider: openai, model_tier: large }
      researcher: { provider: openai, model_tier: medium }
```

---

### xAI (Grok)

**SDK:** `openai` npm package with `baseURL: https://api.x.ai/v1`. Fully
OpenAI-compatible — same streaming and tool-use shape.

**Authentication:** Set `XAI_API_KEY`.

**Supported tiers:** `large` (`grok-4.3`, 1M context, stable alias),
`medium` and `small` (`grok-3-mini-beta`).

**Known quirks:**
- Several `grok-4` variant IDs (e.g. `grok-4-0709`, `grok-4-fast-*`) were
  retired on 2026-05-15. Always use the tier names — do not hard-code model IDs
  in config profiles. `grok-4.3` is the stable large alias.

**Config example:**

```yaml
models:
  profile: balanced
  profiles:
    balanced:
      researcher: { provider: xai, model_tier: large }
```

---

### Moonshot (Kimi)

**SDK:** `openai` npm package with `baseURL: https://api.moonshot.ai/v1`.
OpenAI-compatible with a few behavioural differences.

**Authentication:** Set `MOONSHOT_API_KEY`.

**Supported tiers:** `large` (`kimi-k2.6`, 256K context),
`medium` and `small` (`kimi-k2.5`).

**Known quirks:**
- `tool_choice: "required"` is not supported. The dispatcher clamps to `"auto"`
  and logs a warning. Use Anthropic for agents that must force tool use.
- Temperature is clamped per model (`1.0` for thinking variants, `0.6`
  otherwise). Caller-supplied temperature is silently overridden.
- The deprecated `functions` param is not accepted — only the `tools` shape.
- The original `kimi-k2` series (not `kimi-k2.5` / `kimi-k2.6`) discontinues
  2026-05-25. Use tier names rather than hard-coding model IDs.

**Config example:**

```yaml
models:
  profile: balanced
  profiles:
    balanced:
      verifier: { provider: moonshot, model_tier: medium }
```

---

## v1 limitation: tool execution

In v1, **tool execution is only supported on the Anthropic provider.** The
programmer, debugger, backend, frontend, and other tool-using specialists spawn
Claude Code via `spawnClaude` — a process that manages the full tool-use loop
(file reads, edits, bash calls). Non-Anthropic providers receive text prompts
and stream text responses; they do not execute tools.

**Recommendation:** Keep tool-using agents on Anthropic and route text-only
agents (planner, researcher, verifier, pr-generator, feedback-learner) to other
providers for cost or speed benefits.

Example of recommended per-agent routing:

```yaml
models:
  profile: balanced
  profiles:
    balanced:
      # Tool-using agents — keep on Anthropic
      programmer: { provider: anthropic, model_tier: large }
      debugger: { provider: anthropic, model_tier: large }
      backend: { provider: anthropic, model_tier: medium }
      frontend: { provider: anthropic, model_tier: medium }

      # Text-only agents — route to other providers
      planner: { provider: openai, model_tier: large }
      researcher: { provider: xai, model_tier: large }
      verifier: { provider: moonshot, model_tier: medium }
```

Full tool-execution support for non-Anthropic providers is planned for a future
release.

---

## Migration: `model:` frontmatter → `model_tier:`

Pre-T5 agent specs used a `model: opus|sonnet|haiku` frontmatter field.
Custom agents you have written may still use this form.

**Legacy form (still accepted — will be removed in v0.7.x):**

```yaml
---
model: opus
---
```

**New canonical form:**

```yaml
---
model_tier: large
---
```

The dispatcher normalises legacy names automatically using this table:

| Legacy `model:` value | Resolves to `model_tier:` | Provider |
|-----------------------|--------------------------|----------|
| `opus` | `large` | `anthropic` |
| `sonnet` | `medium` | `anthropic` |
| `haiku` | `small` | `anthropic` |

Tier names (`large`, `medium`, `small`) are also accepted as bare strings in
`config.yaml` profiles, with `provider` defaulting to `anthropic`.

To migrate a custom agent spec, open its `.claude/agents/<name>.md` file and
replace:

```
model: opus
```

with:

```
model_tier: large
```

The provider defaults to `anthropic` unless overridden in your `config.yaml`
profile.

---

## Troubleshooting

### Missing API key

**Symptom:**

```
[providers] Missing env var 'OPENAI_API_KEY' for provider 'openai'. Set it before running.
```

**Fix:** Export the correct env var for your chosen provider. The dispatcher
validates before any spawn — no partial execution occurs on a missing key.

### Unknown model / model\_not\_found

If you pin a model ID directly (e.g. in a one-off test) and the provider rejects
it, use the tier name instead (`large`, `medium`, or `small`) and let the
dispatcher resolve the current canonical ID from `TIER_MODEL_MAP`. Do not
hard-code model IDs in `config.yaml` profiles.

### Tool-use loop does not fire on non-Anthropic provider

This is expected behaviour in v1. Non-Anthropic providers receive a text prompt
and return text. If you see an agent that should be editing files but only
returns prose, check that the agent is pinned to `provider: anthropic` in your
profile. See [v1 limitation](#v1-limitation-tool-execution).

### Moonshot: `tool_choice 'required'` error

```
[providers] Moonshot does not support tool_choice='required'; use 'auto'.
```

Route agents that require forced tool calls (programmer, debugger) to the
Anthropic provider.

---

## See also

- [README — Provider Configuration](../README.md#provider-configuration)
- [action/README.md — GitHub Actions wiring](../action/README.md)
