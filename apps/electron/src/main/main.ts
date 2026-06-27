import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { TeamEngine } from '@websitelabs/software-teams-engine';
import { resolveEnginePaths } from './engine-paths';
import { TeamSession } from './team-session';
import {
  IPC,
  type ClearMsg,
  type PaneInputMsg,
  type ResizeMsg,
  type StartTeamRequest,
} from '../shared/ipc';

const here = dirname(fileURLToPath(import.meta.url)); // dist/
const appDir = join(here, '..'); // apps/electron

const state: {
  window: BrowserWindow | undefined;
  session: TeamSession | undefined;
  repoRoot: string | undefined;
  rosterTimer: ReturnType<typeof setInterval> | undefined;
} = { window: undefined, session: undefined, repoRoot: undefined, rosterTimer: undefined };

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

async function startTeam(request: StartTeamRequest): Promise<void> {
  await stopTeam();
  const paths = resolveEnginePaths(appDir);
  const engine = await TeamEngine.start({
    repoRoot: request.repoRoot,
    proxyPath: paths.proxyPath,
    routeHookPath: paths.routeHookPath,
    agentsDir: paths.agentsDir,
  });
  const session = new TeamSession(engine);
  state.session = session;
  state.repoRoot = request.repoRoot;
  session.onOutput((output) => send(IPC.paneOutput, output));
  session.onActivity((activity) => send(IPC.activity, activity));
  send(IPC.ready, { agents: session.agents(), repoRoot: request.repoRoot });
  state.rosterTimer = setInterval(() => send(IPC.roster, { roster: session.roster() }), 1000);
}

async function stopTeam(): Promise<void> {
  if (state.rosterTimer) {
    clearInterval(state.rosterTimer);
    state.rosterTimer = undefined;
  }
  const session = state.session;
  state.session = undefined;
  state.repoRoot = undefined;
  if (session) await session.stop();
}

function wireIpc(): void {
  ipcMain.handle(IPC.getState, () => ({
    running: state.session !== undefined,
    agents: state.session?.agents() ?? [],
    repoRoot: state.repoRoot ?? '',
  }));
  ipcMain.handle(IPC.pickRepo, async () => {
    if (!state.window) return null;
    const result = await dialog.showOpenDialog(state.window, { properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle(IPC.startTeam, async (_event, request: StartTeamRequest) => {
    try {
      await startTeam(request);
      return { ok: true };
    } catch (error) {
      send(IPC.notice, { level: 'error', text: String(error) });
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.handle(IPC.stopTeam, async () => {
    await stopTeam();
    return { ok: true };
  });
  ipcMain.on(IPC.paneInput, (_event, message: PaneInputMsg) =>
    state.session?.input(message.agent, message.data),
  );
  ipcMain.on(IPC.resize, (_event, message: ResizeMsg) =>
    state.session?.resize(message.agent, message.cols, message.rows),
  );
  ipcMain.on(IPC.clear, (_event, message: ClearMsg) => state.session?.clear(message.agent));
  ipcMain.on(IPC.clearAll, () => state.session?.clearAll());
}

void app.whenReady().then(() => {
  wireIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void stopTeam().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
