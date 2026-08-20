# HANDOFF

## RESUME HERE

- **Repo:** `software-teams` on `main` @ `88b4b34` - clean, pushed, green.
- **PR #23 is merged. `1.0.0` is PUBLISHED to npm** (both packages). Public and
  irreversible; a mistake needs `1.0.1`, never a re-publish.
- **Infra:** `~/src/infra` on `feature/n8n-nodes` @ `c54758a` - pushed.
  **[PR #22](https://github.com/positivegroup/infra/pull/22) is OPEN and green**
  (`fmt` + all three `plan` jobs pass). **Not merged, not applied.** It now covers both
  the community-package install **and** getting the `claude` binary onto the pods.

**The goal is to get Software Teams running in n8n staging.** Everything is published
and the infra change is written, validated and planned; what remains is landing it and
wiring one workflow.

Next 3 items, in order:

1. **Land PR #22.** The plans are verified: `dev` no changes, `stg` 1 to change
   (`module.n8n.helm_release.n8n` in place, `values` only, exactly the two new env
   vars), `prod` no changes. Two steps remain, both human:
   - **Squash-merge** it (the ruleset requires linear history and signed commits;
     local commits are unsigned, so a GitHub squash is what makes it verified).
   - Then `terraform-apply` fires on `main` as dev -> stg -> prod. dev applies
     automatically and is a no-op; **`stg` pauses in the Actions UI for 1 reviewer
     approval** - approve it. prod pauses too and is a no-op; approving or declining it
     changes nothing, but declining leaves `main` unapplied for prod.

   On apply, n8n restarts and installs
   `@websitelabs/n8n-nodes-software-teams@1.0.0`.
2. **Confirm the nodes loaded.** In staging, open a workflow and search the palette for
   `Software Teams`; expect **13 nodes**. Or from a logged-in browser console:
   `fetch('/types/nodes.json').then(r=>r.json()).then(l=>console.log(l.filter(n=>/softwareTeams/i.test(n.name)).length))`
   Before the apply this returns `0`.
3. **Wire and run the NDP-34603 triage by hand** (see "ClickUp without a new
   credential" below). Do NOT enable the ClickUp tag trigger until that run looks right.

## Where things stand

Nine slices are done and shipped. `BUILD-PLAN.md` holds the full record with each
slice's findings; `MIGRATING.md` covers 0.13.x to 1.0.0; `packages/n8n/RUNBOOK.md` is the
operator guide (install, credentials, first run, safe activation, recovery).

Slice 9's remaining work is exactly items 1-3 above, plus the live-ticket verification
that was deferred from the start.

**The `claude` binary is now handled in PR #22** (commit `c54758a`), via an init container
rather than a derived image. A derived image would have meant introducing ECR plus an
image build pipeline into an infra repo that has neither, and it could not have been
tested from here. What landed instead:

- New module variable `claude_code_version`, default `null`. `stg` sets `"2.1.233"`.
- An init container npm-installs the CLI into an `emptyDir` shared read-only with the n8n
  container; `config.extraEnv` prepends `/opt/claude-code/bin` to `PATH`.
- **The init container reuses the n8n image on purpose.** `@anthropic-ai/claude-code`
  ships its real binary as a per-platform optional dependency, and the n8n image is
  **musl (Alpine)** on `linux/amd64` (it is a Docker Hardened Image built on
  `dhi/pkg-node:24.15.0-alpine3.22`, with node 24.15.0 and npm 11.14.1 present, running as
  uid 1000). Installing on a glibc image would fetch the wrong binary.
- `image:` in the init container is written as `{{ .Values.image.repository }}:{{ .Values.image.tag }}`
  and left for Helm to resolve. The chart documents that `extraInitContainers` is passed
  through `tpl`, so this tracks `image_tag` with no duplication. A literal `{{` in those
  values would need escaping as `{{ "{{" }}`.
- `volumes.yaml` had to become `volumes.yaml.tftpl`: `extraVolumes` is a **list**, and a
  second values file declaring it would replace the postgres-cert and environment volumes
  rather than add to them.
- Setting `PATH` restates the image's own default,
  `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`. Revisit if `image_tag`
  ever changes it.

Still open before a run works: the **Software Teams credential** has to be created in the
n8n UI from a `claude setup-token` token.

## Gotchas learned this session

**Staging n8n (host in `.mcp.json`, local-only; v2.22.6)**

- Community packages are **env-managed** (`N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true`),
  so the Community Nodes UI is read-only. The package cannot be installed by clicking;
  it only arrives via the helm change.
- That flag also means `N8N_COMMUNITY_PACKAGES` is the **whole desired state** - n8n
  uninstalls anything not in the list on every restart.
- Our package is **not** in n8n's vetted registry. If `N8N_UNVERIFIED_PACKAGES_ENABLED`
  is ever set false, n8n **refuses to start** rather than skipping the node. It is set
  explicitly to `true` in `config.yaml.tftpl` for that reason.
- `N8N_COMMUNITY_PACKAGES` wants a **JSON string**, not a YAML list - hence
  `jsonencode([for pkg in var.community_packages : { name = pkg }])` in `helm.tf`.
- Instance-level MCP is enabled at `/mcp-server/http` on the staging host,
  **Bearer** auth (probe returns `401` + `WWW-Authenticate: Bearer realm="n8n MCP Server"`).
- Navigating to `/settings/api` bounced the session to a sign-in wall; expect to re-auth.

**ClickUp without a new credential (this replaced an earlier wrong plan)**

Do **not** create a `SoftwareTeamsClickUpApi` credential for the manual run. Staging
already has a **ClickUp OAuth2** credential. Ticket Intake's `Source: Ticket JSON or
Text` path runs the *same* PII scrubbing as the ClickUp path and accepts `name` as well
as `title`, which is what ClickUp's API returns. So:

```
ClickUp node (Get Task) -> Ticket Intake (Source: Ticket JSON or Text) -> Claude Code (triage) -> Switch -> Human Review
```

Caveat: the ClickUp node's *Get Task* does not return comments - that is a separate
`Task Comment -> Get All` operation. Either add a second node and merge, or run without
comments first. Our own ClickUp credential is still needed later for the **tag-polling
trigger**, which needs to poll on its own schedule.

Test ticket: `https://app.clickup.com/t/36826178/NDP-34603` (workspace `36826178`).

**The infra repo (`positivegroup/infra`)**

- **CI owns plan and apply; there is no manual apply.** `terraform-fmt` and
  `terraform-plan` (dev/stg/prod in parallel, commenting each plan on the PR) run on the
  PR; `terraform-apply` runs on every push to `main`, dev -> stg -> prod sequentially,
  with stg and prod each pausing for 1 reviewer approval. To re-apply without a code
  change, push an empty commit to `main`.
- **You cannot plan locally.** AWS auth is GitHub OIDC only, so there are no local
  credentials. `terraform init -backend=false && terraform validate` in each env dir is
  the most you can do offline, and it is worth doing - it catches everything `fmt` won't.
- Terraform is now installed locally: **v1.15.8** via `brew install hashicorp/tap/terraform`
  (it is not in homebrew-core). CI pins **1.10.5**; `fmt` output agrees between the two.
- Branch ruleset on `main`: no required review, but `required_linear_history` and
  `required_signatures`. Local commits are unsigned, so **squash-merge** - GitHub signs
  the squashed commit. That is what every recent commit on `main` did.
- **The n8n module is shared with prod.** `prod/main.tf` calls it too, so any
  unconditional addition to `config.yaml.tftpl` rewrites prod's helm values and restarts
  prod n8n. The community-package env vars are therefore rendered only when
  `length(community_packages) > 0`, which keeps prod's render byte-identical to `main`
  and its plan empty. Verify that claim the same way next time: render the template with
  an empty and a populated list through `terraform console`/a scratch `templatefile`
  output, and diff both against `git show origin/main:...`.

**Still required before a run works**

- The **`claude` binary** is handled by PR #22 now. Note it lands on `n8n-main` as well as
  `n8n-worker`, which matters because a manual execution from the UI runs on main.
- **`ANTHROPIC_API_KEY` must not be set on the worker.** It outranks the OAuth token, so
  runs succeed while silently billing the API instead of the subscription. Confirmed
  clean: nothing in `~/src/infra` sets it.
- Create **Software Teams API** credential with a `claude setup-token` token. Its test
  asserts `authMethod`, not merely `loggedIn`.

**MCP for this harness**

`.mcp.json` (project-level, gitignored) has an `n8n-stg` entry using
`Authorization: Bearer ${N8N_MCP_TOKEN}`. The API key exists in the user's password
manager but is **not** exported yet. Needs `N8N_MCP_TOKEN` in the environment **and a
harness restart** - MCP servers load at startup.

**Repo rules**

- The infra repo rejects pushes whose author email is not `@lmg.broker`. Set
  `git config user.email ben.zotti@lmg.broker` there (done locally already).
- In `software-teams`, `packages/cli/dist/index.js` is generated but **tracked**, and
  must be rebuilt and committed in the same commit as any version bump.
- After changing an agent spec, regenerate the cost baseline:
  `bun run --cwd packages/cli bench:spawn-cost --write-baseline`, committed together.

## How to resume

Start a fresh session and say: **"read HANDOFF.md and continue"**.

Then `git pull` in both repos, re-run the gates below to confirm the baseline still
holds, and start at item 1.

## Certified green @ `88b4b34`

| Gate | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint` | PASS |
| `bun run test` | PASS - 1168 cli, 974 n8n, 0 fail |
| `bun run build` | PASS |
| `bun run verify:node-load` | PASS - 15/15 under Node |
| `validate-frontmatter` | PASS - 50 files |
| `claude plugin validate` | PASS |
| n8n zero-runtime-deps | PASS |

Re-run and re-confirmed on 2026-08-17. `bun run build` reproduced the tracked
`packages/cli/dist/index.js` byte-identically (clean tree afterwards).

## Certified green - infra `feature/n8n-nodes` @ `9c8e0d2`

| Gate | Result |
|---|---|
| `terraform fmt -recursive -check` | PASS (local and CI) |
| `terraform validate` dev / stg / prod | PASS (local, `-backend=false`) |
| CI `plan (dev)` | PASS - No changes |
| CI `plan (stg)` | PASS - 0 to add, 1 to change, 0 to destroy |
| CI `plan (prod)` | PASS - No changes |
| `helm template` with the module's real values | PASS - init container, volume, ro mount and PATH on both `n8n-main` and `n8n-worker` |
| `which claude` in `n8nio/n8n:2.22.6` as uid 1000 | PASS - `2.1.233 (Claude Code)` |

How to redo the last two: `helm pull oci://ghcr.io/n8n-io/n8n-helm-chart/n8n --version 1.8.0 --untar`
(note the chart name is part of the OCI ref; omitting it 403s), render each `.tftpl`
through a scratch `templatefile` output, then `helm template` the chart with those files
plus the `set` blocks from `helm.tf`.
