import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { TeamEngine, type PermissionMode } from '@websitelabs/software-teams-engine';
import { resolveEnginePaths } from './engine-paths';
import { TeamSession } from './team-session';
import {
  IPC,
  type ClearMsg,
  type ClearAllMsg,
  type PaneInputMsg,
  type ResizeMsg,
  type StartTeamRequest,
  type StopTeamRequest,
} from '../shared/ipc';

const here = dirname(fileURLToPath(import.meta.url)); // dist/
const appDir = join(here, '..'); // apps/electron

// Panes run hands-off by default: bypassPermissions executes tools/bash without
// approval prompts (the whole point of a self-driving team). Override with
// ST_PERMISSION_MODE=acceptEdits|auto|default for a more cautious run.
const PERMISSION_MODE =
  (process.env.ST_PERMISSION_MODE as PermissionMode | undefined) ?? 'bypassPermissions';

interface Tab {
  readonly session: TeamSession;
  readonly repoRoot: string;
  readonly rosterTimer: ReturnType<typeof setInterval>;
}

/** One independent team per tab (session id). */
const sessions = new Map<string, Tab>();
const state: { window: BrowserWindow | undefined } = { window: undefined };

function send(channel: string, payload: unknown): void {
  state.window?.webContents.send(channel, payload);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b0f14',
    title: 'Software Teams Cockpit',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void window.loadFile(join(here, 'index.html'));
  window.on('closed', () => {
    state.window = undefined;
  });
  state.window = window;
}

async function startTeam(sessionId: string, repoRoot: string): Promise<void> {
  await stopTeam(sessionId); // restart if this tab already has a team
  const paths = resolveEnginePaths(appDir);
  const engine = await TeamEngine.start({
    repoRoot,
    permissionMode: PERMISSION_MODE,
    proxyPath: paths.proxyPath,
    routeHookPath: paths.routeHookPath,
    agentsDir: paths.agentsDir,
  });
  const session = new TeamSession(engine);
  session.onOutput((output) => send(IPC.paneOutput, { sessionId, ...output }));
  session.onActivity((activity) => send(IPC.activity, { sessionId, ...activity }));
  const rosterTimer = setInterval(
    () => send(IPC.roster, { sessionId, roster: session.roster() }),
    1000,
  );
  sessions.set(sessionId, { session, repoRoot, rosterTimer });
  send(IPC.ready, { sessionId, agents: session.agents(), repoRoot });
}

async function stopTeam(sessionId: string): Promise<void> {
  const tab = sessions.get(sessionId);
  if (!tab) return;
  sessions.delete(sessionId);
  clearInterval(tab.rosterTimer);
  await tab.session.stop();
}

async function stopAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => stopTeam(id)));
}

function wireIpc(): void {
  ipcMain.handle(IPC.getState, () => ({
    sessions: [...sessions.entries()].map(([sessionId, tab]) => ({
      sessionId,
      agents: tab.session.agents(),
      repoRoot: tab.repoRoot,
    })),
  }));
  ipcMain.handle(IPC.pickRepo, async () => {
    if (!state.window) return null;
    const result = await dialog.showOpenDialog(state.window, { properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle(IPC.startTeam, async (_event, request: StartTeamRequest) => {
    try {
      await startTeam(request.sessionId, request.repoRoot);
      return { ok: true };
    } catch (error) {
      send(IPC.notice, { sessionId: request.sessionId, level: 'error', text: String(error) });
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.handle(IPC.stopTeam, async (_event, request: StopTeamRequest) => {
    await stopTeam(request.sessionId);
    return { ok: true };
  });
  ipcMain.on(IPC.paneInput, (_event, message: PaneInputMsg) =>
    sessions.get(message.sessionId)?.session.input(message.agent, message.data),
  );
  ipcMain.on(IPC.resize, (_event, message: ResizeMsg) =>
    sessions.get(message.sessionId)?.session.resize(message.agent, message.cols, message.rows),
  );
  ipcMain.on(IPC.clear, (_event, message: ClearMsg) =>
    sessions.get(message.sessionId)?.session.clear(message.agent),
  );
  ipcMain.on(IPC.clearAll, (_event, message: ClearAllMsg) =>
    sessions.get(message.sessionId)?.session.clearAll(),
  );
}

void app.whenReady().then(() => {
  wireIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void stopAll().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
