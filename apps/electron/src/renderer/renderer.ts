import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AgentDescriptor, RosterMemberMsg, TeamApi } from '../shared/ipc';

declare global {
  interface Window {
    teamApi: TeamApi;
  }
}

const api = window.teamApi;

interface PaneView {
  readonly term: Terminal;
  readonly fit: FitAddon;
  readonly badge: HTMLElement;
}

const panes = new Map<string, PaneView>();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function makeTerminal(): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    cursorBlink: true,
    theme: { background: '#0b0f14', foreground: '#cdd9e5' },
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

/** Build a pane card (header + terminal) and wire its I/O to the bridge. */
function createPaneCard(agent: AgentDescriptor): HTMLElement {
  const card = el('div', `pane ${agent.isLead ? 'pane-lead' : ''}`);
  const header = el('div', 'pane-header');
  const title = el('span', 'pane-title', agent.isLead ? `${agent.role} (lead)` : agent.role);
  const badge = el('span', 'badge badge-starting', 'starting');
  const clearBtn = el('button', 'pane-clear', 'clear');
  clearBtn.addEventListener('click', () => api.clear(agent.name));
  header.append(title, badge, clearBtn);

  const body = el('div', 'pane-body');
  card.append(header, body);

  const { term, fit } = makeTerminal();
  // Open after the node is attached so the fit addon can measure.
  requestAnimationFrame(() => {
    term.open(body);
    fit.fit();
    api.resize(agent.name, term.cols, term.rows);
  });
  term.onData((data) => api.sendInput(agent.name, data));

  panes.set(agent.name, { term, fit, badge });
  return card;
}

function buildCockpit(agents: readonly AgentDescriptor[], repoRoot: string): void {
  byId('start').hidden = true;
  byId('cockpit').hidden = false;
  byId<HTMLElement>('repo-label').textContent = repoRoot;

  const lead = byId('lead');
  const grid = byId('grid');
  lead.replaceChildren();
  grid.replaceChildren();
  for (const agent of agents) {
    (agent.isLead ? lead : grid).append(createPaneCard(agent));
  }
}

function updateRoster(roster: readonly RosterMemberMsg[]): void {
  for (const member of roster) {
    const view = panes.get(member.name);
    if (!view) continue;
    const queued = member.queued > 0 ? ` ·${member.queued}` : '';
    view.badge.textContent = `${member.status}${queued}`;
    view.badge.className = `badge badge-${member.status}`;
  }
}

function fitAll(): void {
  for (const [name, view] of panes) {
    view.fit.fit();
    api.resize(name, view.term.cols, view.term.rows);
  }
}

function pushActivity(text: string): void {
  const list = byId('feed-list');
  const item = el('li', 'feed-item', text);
  list.prepend(item);
  while (list.childElementCount > 200) list.lastElementChild?.remove();
}

function wireControls(): void {
  const repoInput = byId<HTMLInputElement>('repo');
  byId('pick').addEventListener('click', async () => {
    const picked = await api.pickRepo();
    if (picked) repoInput.value = picked;
  });
  byId('start-btn').addEventListener('click', async () => {
    const repoRoot = repoInput.value.trim();
    if (!repoRoot) return;
    byId<HTMLElement>('start-error').textContent = '';
    const result = await api.startTeam(repoRoot);
    if (!result.ok) byId<HTMLElement>('start-error').textContent = result.error ?? 'Failed to start team.';
  });
  byId('clear-all').addEventListener('click', () => api.clearAll());
  byId('stop').addEventListener('click', async () => {
    await api.stopTeam();
    byId('cockpit').hidden = true;
    byId('start').hidden = false;
    panes.clear();
  });
  window.addEventListener('resize', fitAll);
}

async function main(): Promise<void> {
  wireControls();
  api.onReady((msg) => buildCockpit(msg.agents, msg.repoRoot));
  api.onPaneOutput((msg) => panes.get(msg.agent)?.term.write(msg.chunk));
  api.onRoster((msg) => updateRoster(msg.roster));
  api.onActivity((msg) => pushActivity(`${msg.from} → ${msg.to ?? 'all'} · ${msg.kind}: ${msg.summary}`));
  api.onNotice((msg) => pushActivity(`[${msg.level}] ${msg.text}`));

  // Reconnect after a renderer reload (Cmd-R): if a team is already running in
  // the main process, rebuild the cockpit instead of showing the start screen.
  const current = await api.getState();
  if (current.running) buildCockpit(current.agents, current.repoRoot);
}

void main();
