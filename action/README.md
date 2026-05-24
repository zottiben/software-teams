# Software Teams GitHub Action

The `action/` directory contains the GitHub Action composite that powers the
"Hey software-teams" workflow. For the general provider overview and env var
table see [README — Provider Configuration](../README.md#provider-configuration);
for full per-provider SDK and model details see
[`docs/providers.md`](../docs/providers.md).

As of the multi-provider release there are two composite files:

| File | Role |
|------|------|
| `action.yml` | Public entry point — compat shim that defaults to `provider: anthropic`. Zero behaviour change for existing users. |
| `action-multiprovider.yml` | Provider-agnostic body. `action.yml` delegates here; use this directly if you need explicit provider control. |

---

## Provider input

Both composites accept a `provider` input:

```yaml
provider:
  default: 'anthropic'
  # allowed: anthropic | openai | xai | moonshot
```

Omitting `provider` (or setting it to `anthropic`) routes through
`anthropics/claude-code-action` — behaviour is identical to all previous
releases.

---

## Per-provider secrets

Set **only** the secret for the provider you are using. The others are ignored
at runtime but are harmless if present.

| Provider | Input | Env var (self-hosted) | Required |
|----------|-------|----------------------|----------|
| `anthropic` | `anthropic_api_key` | `ANTHROPIC_API_KEY` | yes |
| `openai` | `openai_api_key` | `OPENAI_API_KEY` | yes |
| `xai` | `xai_api_key` | `XAI_API_KEY` | yes |
| `moonshot` | `moonshot_api_key` | `MOONSHOT_API_KEY` | yes |

Missing the required key for the selected provider causes an immediate, descriptive
error before any agent spawns.

---

## Workflow snippets

### Anthropic (default — no changes required for existing users)

```yaml
- uses: websitelabs/software-teams@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### OpenAI

```yaml
- uses: websitelabs/software-teams@v1
  with:
    provider: openai
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

### xAI (Grok)

```yaml
- uses: websitelabs/software-teams@v1
  with:
    provider: xai
    xai_api_key: ${{ secrets.XAI_API_KEY }}
```

### Moonshot (Kimi)

```yaml
- uses: websitelabs/software-teams@v1
  with:
    provider: moonshot
    moonshot_api_key: ${{ secrets.MOONSHOT_API_KEY }}
```

---

## All inputs

| Input | Default | Description |
|-------|---------|-------------|
| `provider` | `anthropic` | LLM provider: `anthropic`, `openai`, `xai`, `moonshot` |
| `anthropic_api_key` | — | Required when `provider=anthropic` |
| `openai_api_key` | — | Required when `provider=openai` |
| `xai_api_key` | — | Required when `provider=xai` |
| `moonshot_api_key` | — | Required when `provider=moonshot` |
| `clickup_api_token` | `` | ClickUp API token for ticket fetching (optional) |
| `allowed_users` | `` | Comma-separated GitHub usernames allowed to trigger |
| `trigger_phrase` | `Hey software-teams` | Phrase that activates the action |
| `software_teams_version` | `latest` | `@websitelabs/software-teams` version to install |
| `claude_code_action_version` | `v1` | `anthropics/claude-code-action` version (anthropic branch only) |

## Outputs

| Output | Description |
|--------|-------------|
| `session_id` | Claude Code session ID (anthropic branch only; empty for other providers) |
| `execution_file` | Path to Claude Code execution output (anthropic branch only; empty for other providers) |

---

## Branch behaviour

**Anthropic branch** (`provider=anthropic`)

Steps: Setup Bun → Bootstrap → `anthropics/claude-code-action@<version>`.
The Claude Code action receives the same `prompt`, `claude_args`, and env vars
as the pre-multi-provider release, making this path byte-equivalent for T13
regression assertions.

**Non-anthropic branch** (`provider=openai|xai|moonshot`)

Steps: Setup Bun → Bootstrap → Configure git → Install `@websitelabs/software-teams`
globally → `software-teams action run` with `--provider <value>` and the
provider env var exported. This mirrors the self-hosted CLI path in
`workflow-template.yml`.

Provider misconfiguration (unknown provider name or missing API key) causes
`exit 1` with an actionable message before any network call.

---

## Self-hosted workflow (`workflow-template.yml`)

The `software-teams setup-action` command drops
`.github/workflows/software-teams.yml` into your repo. This file is kept
byte-identical to `action/workflow-template.yml` (comments aside).

### Selecting a provider via `SOFTWARE_TEAMS_PROVIDER`

Set the **repository variable** `SOFTWARE_TEAMS_PROVIDER` to one of
`anthropic`, `openai`, `xai`, or `moonshot`. Omitting the variable defaults
to `anthropic` — no configuration change is needed for existing workflows.

```yaml
# .github/workflows/software-teams.yml (excerpt)
env:
  SOFTWARE_TEAMS_PROVIDER: ${{ vars.SOFTWARE_TEAMS_PROVIDER || 'anthropic' }}
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
  MOONSHOT_API_KEY: ${{ secrets.MOONSHOT_API_KEY }}
```

All four env vars are exported to the runner. GitHub Actions treats unset
secrets as empty strings; the dispatcher's fail-fast validation surfaces a
clear error if the selected provider's key is missing before any agent spawns.

**To switch providers:**

1. Go to **Settings → Secrets and variables → Actions → Variables**.
2. Create or update `SOFTWARE_TEAMS_PROVIDER` with your chosen value.
3. Add the corresponding API key as a **secret** (e.g. `OPENAI_API_KEY`).
4. No change to the workflow file is required.

### Per-provider repo secrets

| Provider | Repo secret name |
|----------|-----------------|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `moonshot` | `MOONSHOT_API_KEY` |

---

## No behaviour change for existing users

The multi-provider release was validated by the T13 Anthropic Regression Gate
(`.software-teams/thoughts/anthropic-regression-report.md`). All 6 regression
assertions passed:

- `action.yml` is a thin shim — it delegates to `action-multiprovider.yml` with
  `provider: anthropic`, making the execution path byte-equivalent to all
  previous releases.
- `workflow-template.yml` defaults `SOFTWARE_TEAMS_PROVIDER` to `anthropic`.
  Existing workflows that do not set this variable see no change in behaviour.
- 528 tests pass, including explicit checks for the Anthropic R-01 invariant.

For full evidence see the regression report linked above.

---

## See also

- [README — Provider Configuration](../README.md#provider-configuration)
- [docs/providers.md — per-provider reference](../docs/providers.md)
