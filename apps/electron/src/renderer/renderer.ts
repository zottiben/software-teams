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

interface TabRefs {
  readonly startEl: HTMLElement;
  readonly repoInput: HTMLInputElement;
  readonly startError: HTMLElement;
  readonly cockpitEl: HTMLElement;
  readonly repoLabel: HTMLElement;
  readonly leadEl: HTMLElement;
  readonly gridEl: HTMLElement;
  readonly feedListEl: HTMLElement;
}

interface Tab {
  readonly id: string;
  running: boolean;
  repoRoot: string | undefined;
  readonly button: HTMLElement;
  readonly label: HTMLElement;
  readonly panel: HTMLElement;
  readonly refs: TabRefs;
  readonly panes: Map<string, PaneView>;
}

const tabs = new Map<string, Tab>();
const active = { id: undefined as string | undefined };
const tabSeq = { n: 0 };

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

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? (parts[parts.length - 1] ?? path) : path;
}

// --- tab lifecycle -----------------------------------------------------------

function buildTabPanel(id: string, panel: HTMLElement): TabRefs {
  const startEl = el('div', 'start');
  const row = el('div', 'row');
  const repoInput = el('input');
  repoInput.type = 'text';
  repoInput.placeholder = '/path/to/your/repo';
  const browse = el('button', '', 'Browse…');
  row.append(repoInput, browse);
  const startBtn = el('button', 'primary', 'Start team');
  const startError = el('p', 'error');
  startEl.append(
    el('h1', '', 'Software Teams Cockpit'),
    el('p', 'muted', 'Open a live team for a repo — and lead it.'),
    row,
    startBtn,
    startError,
    el('p', 'hint muted', 'Each specialist opens in its own pane and git worktree.'),
  );

  const cockpitEl = el('div', 'cockpit');
  cockpitEl.hidden = true;
  const topbar = el('header', 'topbar');
  const repoLabel = el('span', 'muted');
  const clearAll = el('button', '', 'Clear all context');
  const stop = el('button', 'danger', 'Stop team');
  topbar.append(el('span', 'brand', 'Team'), repoLabel, el('span', 'spacer'), clearAll, stop);
  const layout = el('main', 'layout');
  const leadEl = el('section', 'lead');
  const gridEl = el('section', 'grid');
  const feed = el('aside', 'feed');
  const feedListEl = el('ul', 'feed-list');
  feed.append(el('h2', '', 'Team activity'), feedListEl);
  layout.append(leadEl, gridEl, feed);
  cockpitEl.append(topbar, layout);

  panel.append(startEl, cockpitEl);

  browse.addEventListener('click', async () => {
    const picked = await api.pickRepo();
    if (picked) repoInput.value = picked;
  });
  startBtn.addEventListener('click', () => startTeamForTab(id));
  repoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startTeamForTab(id);
  });
  clearAll.addEventListener('click', () => api.clearAll(id));
  stop.addEventListener('click', async () => {
    await api.stopTeam(id);
    resetTabToStart(id);
  });

  return { startEl, repoInput, startError, cockpitEl, repoLabel, leadEl, gridEl, feedListEl };
}

function createTab(): Tab {
  tabSeq.n += 1;
  const id = `tab-${tabSeq.n}`;

  const button = el('div', 'tab');
  const label = el('span', 'tab-label', 'New tab');
  const close = el('button', 'tab-close', '×');
  button.append(label, close);
  button.addEventListener('click', () => activateTab(id));
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    void closeTab(id);
  });
  byId('tabbar').insertBefore(button, byId('newtab'));

  const panel = el('div', 'tabpanel');
  byId('tabpanels').append(panel);

  const tab: Tab = {
    id,
    running: false,
    repoRoot: undefined,
    button,
    label,
    panel,
    refs: buildTabPanel(id, panel),
    panes: new Map(),
  };
  tabs.set(id, tab);
  activateTab(id);
  return tab;
}

function activateTab(id: string): void {
  active.id = id;
  for (const [tabId, tab] of tabs) {
    const isActive = tabId === id;
    tab.panel.hidden = !isActive;
    tab.button.classList.toggle('active', isActive);
  }
  const tab = tabs.get(id);
  if (tab) requestAnimationFrame(() => fitTab(tab));
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.running) await api.stopTeam(id);
  for (const view of tab.panes.values()) view.term.dispose();
  tab.button.remove();
  tab.panel.remove();
  tabs.delete(id);
  if (tabs.size === 0) {
    createTab();
    return;
  }
  if (active.id === id) {
    const next = [...tabs.keys()][0];
    if (next) activateTab(next);
  }
}

// --- team views --------------------------------------------------------------

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

function createPaneCard(id: string, tab: Tab, agent: AgentDescriptor): HTMLElement {
  const card = el('div', `pane ${agent.isLead ? 'pane-lead' : ''}`);
  const header = el('div', 'pane-header');
  const title = el('span', 'pane-title', agent.isLead ? `${agent.role} (lead)` : agent.role);
  const badge = el('span', 'badge badge-starting', 'starting');
  const clear = el('button', 'pane-clear', 'clear');
  clear.addEventListener('click', () => api.clear(id, agent.name));
  header.append(title, badge, clear);

  const body = el('div', 'pane-body');
  card.append(header, body);

  const { term, fit } = makeTerminal();
  requestAnimationFrame(() => {
    term.open(body);
    if (active.id === id) {
      fit.fit();
      api.resize(id, agent.name, term.cols, term.rows);
    }
  });
  term.onData((data) => api.sendInput(id, agent.name, data));

  tab.panes.set(agent.name, { term, fit, badge });
  return card;
}

function buildCockpit(id: string, agents: readonly AgentDescriptor[], repoRoot: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.running = true;
  tab.repoRoot = repoRoot;
  tab.label.textContent = basename(repoRoot);
  tab.label.title = repoRoot;
  tab.refs.repoLabel.textContent = repoRoot;
  tab.refs.startEl.hidden = true;
  tab.refs.cockpitEl.hidden = false;
  tab.refs.leadEl.replaceChildren();
  tab.refs.gridEl.replaceChildren();
  tab.panes.clear();
  for (const agent of agents) {
    const target = agent.isLead ? tab.refs.leadEl : tab.refs.gridEl;
    target.append(createPaneCard(id, tab, agent));
  }
  if (active.id === id) requestAnimationFrame(() => fitTab(tab));
}

function resetTabToStart(id: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.running = false;
  tab.repoRoot = undefined;
  for (const view of tab.panes.values()) view.term.dispose();
  tab.panes.clear();
  tab.refs.leadEl.replaceChildren();
  tab.refs.gridEl.replaceChildren();
  tab.refs.feedListEl.replaceChildren();
  tab.refs.cockpitEl.hidden = true;
  tab.refs.startEl.hidden = false;
  tab.label.textContent = 'New tab';
}

async function startTeamForTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;
  const repoRoot = tab.refs.repoInput.value.trim();
  if (!repoRoot) return;
  tab.refs.startError.textContent = 'Starting…';
  const result = await api.startTeam(id, repoRoot);
  if (!result.ok) tab.refs.startError.textContent = result.error ?? 'Failed to start team.';
}

function fitTab(tab: Tab): void {
  for (const [name, view] of tab.panes) {
    view.fit.fit();
    api.resize(tab.id, name, view.term.cols, view.term.rows);
  }
}

function updateRoster(tab: Tab, roster: readonly RosterMemberMsg[]): void {
  for (const member of roster) {
    const view = tab.panes.get(member.name);
    if (!view) continue;
    const queued = member.queued > 0 ? ` ·${member.queued}` : '';
    view.badge.textContent = `${member.status}${queued}`;
    view.badge.className = `badge badge-${member.status}`;
  }
}

function pushActivity(tab: Tab, text: string): void {
  const item = el('li', 'feed-item', text);
  tab.refs.feedListEl.prepend(item);
  while (tab.refs.feedListEl.childElementCount > 200) tab.refs.feedListEl.lastElementChild?.remove();
}

// --- bootstrap ---------------------------------------------------------------

async function init(): Promise<void> {
  byId('newtab').addEventListener('click', () => createTab());
  window.addEventListener('keydown', (event) => {
    if (event.metaKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      createTab();
    }
  });
  window.addEventListener('resize', () => {
    const tab = active.id ? tabs.get(active.id) : undefined;
    if (tab) fitTab(tab);
  });

  api.onReady((msg) => buildCockpit(msg.sessionId, msg.agents, msg.repoRoot));
  api.onPaneOutput((msg) => tabs.get(msg.sessionId)?.panes.get(msg.agent)?.term.write(msg.chunk));
  api.onRoster((msg) => {
    const tab = tabs.get(msg.sessionId);
    if (tab) updateRoster(tab, msg.roster);
  });
  api.onActivity((msg) => {
    const tab = tabs.get(msg.sessionId);
    if (tab) pushActivity(tab, `${msg.from} → ${msg.to ?? 'all'} · ${msg.kind}: ${msg.summary}`);
  });
  api.onNotice((msg) => {
    const tab = msg.sessionId ? tabs.get(msg.sessionId) : undefined;
    if (tab) pushActivity(tab, `[${msg.level}] ${msg.text}`);
  });

  // Reconnect after a reload: recreate a tab for each team still running in main.
  const { sessions } = await api.getState();
  for (const session of sessions) {
    const tab = createTab();
    buildCockpit(tab.id, session.agents, session.repoRoot);
  }
  if (sessions.length === 0) createTab();
}

void init();
