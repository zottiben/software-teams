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

## Not yet

Packaging/distribution (electron-builder) is a later phase — this is the runnable dev app.
