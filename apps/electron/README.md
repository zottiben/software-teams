# Software Teams Cockpit (Electron)

A desktop "team-leader cockpit" over [`@websitelabs/software-teams-engine`](../../packages/team-engine). It opens a **live team of Software Teams agents** as terminal panes you lead: the orchestrator in the main pane, each specialist in its own pane (and its own git worktree), all wired to the shared message bus.

- Each pane is a real `claude` process pinned to one specialist persona.
- The orchestrator delegates to the open panes (it does **not** spawn subagents — a route hook enforces it).
- A live **activity feed** shows inter-agent messages; per-pane **idle/busy** badges; **clear context** per pane or all at once.

## Requirements

- `claude` (Claude Code CLI) installed and authenticated — the app spawns real sessions.
- A built engine (the app's `dev` script does this for you).
- Node ≥ 18, Bun (for the build).

## Run it (dev)

From the monorepo root:

```bash
bun install                       # installs Electron (downloads its binary)
bun run --cwd apps/electron dev   # builds the engine bundles + the app, then launches Electron
```

`dev` runs `build:engine` (the MCP proxy + route-hook bundles the panes need at runtime), then `build` (main/preload/renderer), then `electron dist/main.mjs`.

In the window: paste or browse to a git repo, **Start team**. The orchestrator + 8 specialists launch. Talk to the orchestrator; it delegates to the specialist panes, which work in their own worktrees and report back.

**Tabs** — open more teams in new tabs (the ＋ button or ⌘T); each tab is an independent team on its own repo, with its own broker, control server, and worktrees. Close a tab (×) to stop that team. Switching tabs keeps every team running in the background.

> Heads up: this launches several real `claude` sessions at once — it uses your Claude auth and consumes tokens. The persistent panes hold context until you clear them (use the per-pane / clear-all buttons).

## Architecture

| Layer | File | Role |
|---|---|---|
| Main | `src/main/main.ts` | Electron lifecycle + `BrowserWindow` + IPC wiring |
| Main | `src/main/team-session.ts` | Bridges engine panes/broker ↔ IPC (unit-tested with fakes) |
| Main | `src/main/engine-paths.ts` | Resolves the engine bundles + personas in the monorepo |
| Preload | `src/preload/preload.ts` | `contextBridge` → `window.teamApi` |
| Renderer | `src/renderer/renderer.ts` | xterm.js terminal per pane, activity feed, controls |
| Shared | `src/shared/ipc.ts` | Channel names + payload types |

`node-pty` (the PTYs) lives in the engine and runs in the Electron **main** process; its N-API prebuilds load under Electron without a rebuild.

## Packaging a distributable (macOS)

electron-builder produces a `.dmg` + `.zip`. The engine bundles and personas are
copied into the app's `Resources/` (`extraResources`), and `src/main/engine-paths.ts`
resolves them from there when packaged. `node-pty` is materialized from Bun's store
into a real `node_modules` dir before packing (`scripts/prepare-native.ts`).

```bash
# unsigned, for local testing (builds release/mac-arm64/…app):
bun run --cwd apps/electron pack

# signed + notarized .dmg + .zip (needs your Apple credentials, see below):
bun run --cwd apps/electron dist
```

### Signing + notarization (Apple Developer account required)

`dist` signs with your **Developer ID Application** certificate and notarizes via
the App Store Connect API. Provide credentials by environment (never commit them):

- **Signing** — have the Developer ID Application cert in your login keychain
  (electron-builder auto-discovers it), or in CI set `CSC_LINK` (base64/path of a
  `.p12`) and `CSC_KEY_PASSWORD`.
- **Notarization** — an App Store Connect API key:
  - `APPLE_API_KEY` — path to the `AuthKey_XXXX.p8`
  - `APPLE_API_KEY_ID` — the key id
  - `APPLE_API_ISSUER` — the issuer id

Set `appId` (currently `com.websitelabs.software-teams-cockpit`) in
`electron-builder.yml` to your own bundle identifier before the first signed build.
Output lands in `apps/electron/release/`.

### Releasing on GitHub

The cockpit has its own version line — it does **not** reuse the CLI's `v…` tags;
releases are tagged `cockpit-v<version>`.

```bash
# 1. build the signed + notarized DMG (see above) → apps/electron/release/
# 2. cut a DRAFT release with the cockpit-prefixed tag and attach the artifacts:
V=$(node -p "require('./apps/electron/package.json').version")
gh release create "cockpit-v$V" --draft --target main \
  --title "Software Teams Cockpit $V" \
  --notes "Desktop cockpit for Software Teams." \
  apps/electron/release/*.dmg apps/electron/release/*.zip
# 3. review the draft on GitHub, then publish.
```

### End-user prerequisites

The cockpit shells out to local tools, so a user running the packaged app needs
**`claude` (Claude Code, authenticated)** and **`node`** on their `PATH` — the panes
run real `claude`, and the team's MCP proxy / route hook run via `node`. (This is a
developer tool; both are expected.)

### Homebrew

Homebrew doesn't host the binary — a Cask just points at the hosted `.dmg`. Host the
signed/notarized DMG (GitHub Releases recommended), then publish a Cask in your own
tap (`brew install --cask <you>/tap/software-teams-cockpit`). The official
`homebrew/cask` has a notability bar; pursue it once the app is widely used.
