import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type ActivityMsg,
  type NoticeMsg,
  type PaneOutputMsg,
  type RosterMsg,
  type TeamApi,
  type TeamReadyMsg,
  type TeamStateResponse,
} from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TeamApi = {
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<TeamStateResponse>,
  pickRepo: () => ipcRenderer.invoke(IPC.pickRepo) as Promise<string | null>,
  startTeam: (repoRoot) =>
    ipcRenderer.invoke(IPC.startTeam, { repoRoot }) as Promise<{ ok: boolean; error?: string }>,
  stopTeam: () => ipcRenderer.invoke(IPC.stopTeam) as Promise<{ ok: boolean }>,
  sendInput: (agent, data) => ipcRenderer.send(IPC.paneInput, { agent, data }),
  resize: (agent, cols, rows) => ipcRenderer.send(IPC.resize, { agent, cols, rows }),
  clear: (agent) => ipcRenderer.send(IPC.clear, { agent }),
  clearAll: () => ipcRenderer.send(IPC.clearAll),
  onReady: (cb) => subscribe<TeamReadyMsg>(IPC.ready, cb),
  onPaneOutput: (cb) => subscribe<PaneOutputMsg>(IPC.paneOutput, cb),
  onActivity: (cb) => subscribe<ActivityMsg>(IPC.activity, cb),
  onRoster: (cb) => subscribe<RosterMsg>(IPC.roster, cb),
  onNotice: (cb) => subscribe<NoticeMsg>(IPC.notice, cb),
};

contextBridge.exposeInMainWorld('teamApi', api);
