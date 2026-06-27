import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type ActivityMsg,
  type NoticeMsg,
  type PaneOutputMsg,
  type RosterMsg,
  type SessionsStateResponse,
  type TeamApi,
  type TeamReadyMsg,
} from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TeamApi = {
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<SessionsStateResponse>,
  pickRepo: () => ipcRenderer.invoke(IPC.pickRepo) as Promise<string | null>,
  startTeam: (sessionId, repoRoot) =>
    ipcRenderer.invoke(IPC.startTeam, { sessionId, repoRoot }) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  stopTeam: (sessionId) =>
    ipcRenderer.invoke(IPC.stopTeam, { sessionId }) as Promise<{ ok: boolean }>,
  sendInput: (sessionId, agent, data) => ipcRenderer.send(IPC.paneInput, { sessionId, agent, data }),
  resize: (sessionId, agent, cols, rows) =>
    ipcRenderer.send(IPC.resize, { sessionId, agent, cols, rows }),
  clear: (sessionId, agent) => ipcRenderer.send(IPC.clear, { sessionId, agent }),
  clearAll: (sessionId) => ipcRenderer.send(IPC.clearAll, { sessionId }),
  onReady: (cb) => subscribe<TeamReadyMsg>(IPC.ready, cb),
  onPaneOutput: (cb) => subscribe<PaneOutputMsg>(IPC.paneOutput, cb),
  onActivity: (cb) => subscribe<ActivityMsg>(IPC.activity, cb),
  onRoster: (cb) => subscribe<RosterMsg>(IPC.roster, cb),
  onNotice: (cb) => subscribe<NoticeMsg>(IPC.notice, cb),
};

contextBridge.exposeInMainWorld('teamApi', api);
