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
  readonly card: HTMLElement;
}

interface RailChip {
  readonly el: HTMLElement;
  readonly badge: HTMLElement;
}

interface TabRefs {
  readonly startEl: HTMLElement;
  readonly repoInput: HTMLInputElement;
  readonly startError: HTMLElement;
  readonly cockpitEl: HTMLElement;
  readonly repoLabel: HTMLElement;
  readonly leadEl: HTMLElement;
  readonly focusEl: HTMLElement;
  readonly railListEl: HTMLElement;
  readonly drawerEl: HTMLElement;
  readonly feedListEl: HTMLElement;
}

interface Tab {
  readonly id: string;
  running: boolean;
  repoRoot: string | undefined;
  focused: string | undefined;
  readonly button: HTMLElement;
  readonly label: HTMLElement;
  readonly panel: HTMLElement;
  readonly refs: TabRefs;
  readonly panes: Map<string, PaneView>;
  readonly railChips: Map<string, RailChip>;
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
  const activityBtn = el('button', '', 'Activity');
  const clearAll = el('button', '', 'Clear all context');
  const stop = el('button', 'danger', 'Stop team');
  topbar.append(el('span', 'brand', 'Team'), repoLabel, el('span', 'spacer'), activityBtn, clearAll, stop);

  const body = el('div', 'cockpit-body');
  const leadEl = el('section', 'lead');
  const focusEl = el('section', 'focus');
  const rail = el('aside', 'rail');
  const railListEl = el('ul', 'rail-list');
  rail.append(el('h2', '', 'Team'), railListEl);
  body.append(leadEl, focusEl, rail);

  const drawerEl = el('aside', 'drawer');
  drawerEl.hidden = true;
  const feedListEl = el('ul', 'feed-list');
  drawerEl.append(el('h2', '', 'Team activity'), feedListEl);

  cockpitEl.append(topbar, body, drawerEl);
  panel.append(startEl, cockpitEl);

  browse.addEventListener('click', async () => {
    const picked = await api.pickRepo();
    if (picked) repoInput.value = picked;
  });
  startBtn.addEventListener('click', () => startTeamForTab(id));
  repoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startTeamForTab(id);
  });
  activityBtn.addEventListener('click', () => {
    drawerEl.hidden = !drawerEl.hidden;
  });
  clearAll.addEventListener('click', () => api.clearAll(id));
  stop.addEventListener('click', async () => {
    await api.stopTeam(id);
    resetTabToStart(id);
  });

  return { startEl, repoInput, startError, cockpitEl, repoLabel, leadEl, focusEl, railListEl, drawerEl, feedListEl };
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
    focused: undefined,
    button,
    label,
    panel,
    refs: buildTabPanel(id, panel),
    panes: new Map(),
    railChips: new Map(),
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
    scrollback: 8000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

function createPaneCard(id: string, tab: Tab, agent: AgentDescriptor, container: HTMLElement): PaneView {
  const card = el('div', `pane ${agent.isLead ? 'pane-lead' : 'pane-focus'}`);
  const header = el('div', 'pane-header');
  const title = el('span', 'pane-title', agent.isLead ? `${agent.role} (lead)` : agent.role);
  const badge = el('span', 'badge badge-starting', 'starting');
  const clear = el('button', 'pane-clear', 'clear');
  clear.addEventListener('click', () => api.clear(id, agent.name));
  header.append(title, badge, clear);

  const bodyEl = el('div', 'pane-body');
  card.append(header, bodyEl);
  container.append(card);

  const { term, fit } = makeTerminal();
  requestAnimationFrame(() => {
    term.open(bodyEl);
    if (active.id === id && !card.hidden) {
      fit.fit();
      api.resize(id, agent.name, term.cols, term.rows);
    }
  });
  term.onData((data) => api.sendInput(id, agent.name, data));

  const view: PaneView = { term, fit, badge, card };
  tab.panes.set(agent.name, view);
  return view;
}

function createRailChip(id: string, tab: Tab, agent: AgentDescriptor): void {
  const chip = el('li', 'rail-chip');
  const name = el('span', 'rail-name', agent.role);
  const badge = el('span', 'badge badge-starting', 'starting');
  chip.append(name, badge);
  chip.addEventListener('click', () => focusAgent(id, agent.name));
  tab.refs.railListEl.append(chip);
  tab.railChips.set(agent.name, { el: chip, badge });
}

function focusAgent(id: string, name: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.focused = name;
  for (const [paneName, view] of tab.panes) {
    if (view.card.classList.contains('pane-focus')) view.card.hidden = paneName !== name;
  }
  for (const [chipName, chip] of tab.railChips) {
    chip.el.classList.toggle('active', chipName === name);
  }
  const view = tab.panes.get(name);
  if (view && active.id === id) {
    requestAnimationFrame(() => {
      view.fit.fit();
      api.resize(id, name, view.term.cols, view.term.rows);
    });
  }
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
  tab.refs.focusEl.replaceChildren();
  tab.refs.railListEl.replaceChildren();
  tab.panes.clear();
  tab.railChips.clear();

  const specialists: AgentDescriptor[] = [];
  for (const agent of agents) {
    if (agent.isLead) {
      createPaneCard(id, tab, agent, tab.refs.leadEl);
    } else {
      const view = createPaneCard(id, tab, agent, tab.refs.focusEl);
      view.card.hidden = true;
      createRailChip(id, tab, agent);
      specialists.push(agent);
    }
  }
  const first = specialists[0];
  if (first) focusAgent(id, first.name);
  if (active.id === id) requestAnimationFrame(() => fitTab(tab));
}

function resetTabToStart(id: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.running = false;
  tab.repoRoot = undefined;
  tab.focused = undefined;
  for (const view of tab.panes.values()) view.term.dispose();
  tab.panes.clear();
  tab.railChips.clear();
  tab.refs.leadEl.replaceChildren();
  tab.refs.focusEl.replaceChildren();
  tab.refs.railListEl.replaceChildren();
  tab.refs.feedListEl.replaceChildren();
  tab.refs.drawerEl.hidden = true;
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
    if (view.card.hidden) continue;
    view.fit.fit();
    api.resize(tab.id, name, view.term.cols, view.term.rows);
  }
}

function updateRoster(tab: Tab, roster: readonly RosterMemberMsg[]): void {
  for (const member of roster) {
    const queued = member.queued > 0 ? ` ·${member.queued}` : '';
    const label = `${member.status}${queued}`;
    const pane = tab.panes.get(member.name);
    if (pane) {
      pane.badge.textContent = label;
      pane.badge.className = `badge badge-${member.status}`;
    }
    const chip = tab.railChips.get(member.name);
    if (chip) {
      chip.badge.textContent = label;
      chip.badge.className = `badge badge-${member.status}`;
    }
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

  const { sessions } = await api.getState();
  for (const session of sessions) {
    const tab = createTab();
    buildCockpit(tab.id, session.agents, session.repoRoot);
  }
  if (sessions.length === 0) createTab();
}

void init();
