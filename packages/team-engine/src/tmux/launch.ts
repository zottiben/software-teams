import { TeamEngine, type TeamEngineOptions } from '../engine';
import type { Pane } from '../pane/pane';
import { DEFAULT_TEAM } from '../persona/persona';
import type { LaunchSpec, PaneConfig } from '../types';
import { Tmux } from './tmux';
import { TmuxPane } from './tmux-pane';

/** Single-quote a string for safe inclusion in a shell command line. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface LaunchTmuxOptions extends Omit<TeamEngineOptions, 'createPane'> {
  readonly sessionName?: string;
  /** Dedicated tmux server socket (isolation). */
  readonly socketName?: string;
  /** Width of the orchestrator's main pane (cells). */
  readonly mainPaneWidth?: number;
}

export interface TmuxTeam {
  readonly engine: TeamEngine;
  readonly tmux: Tmux;
  /** Command the human runs to attach to the session. */
  readonly attachCommand: string;
}

/**
 * Open a live team in a tmux session: the orchestrator in the main pane, each
 * specialist in its own pane (and its own worktree), every pane a real `claude`
 * wired to the shared broker. Returns once panes are launched; the caller keeps the
 * process alive so the broker/control server stay up.
 */
export async function launchTmux(options: LaunchTmuxOptions): Promise<TmuxTeam> {
  const roster = options.roster ?? DEFAULT_TEAM;
  const sessionName = options.sessionName ?? 'software-teams';
  const tmux = new Tmux(sessionName, options.socketName ? { socketName: options.socketName } : {});
  if (tmux.hasSession()) {
    throw new Error(
      `tmux session '${sessionName}' already exists. Kill it or pass a different sessionName.`,
    );
  }

  const orchestrator = 'software-teams-orchestrator';
  const agentNames = [orchestrator, ...roster.map((slot) => slot.agent)];

  const targets = new Map<string, string>();
  targets.set(orchestrator, tmux.newSession(options.repoRoot));
  for (const name of agentNames.slice(1)) {
    targets.set(name, tmux.splitWindow(options.repoRoot));
    tmux.selectLayout('tiled'); // keep room as panes multiply
  }
  tmux.selectLayout('main-vertical');
  if (options.mainPaneWidth) tmux.setMainPaneWidth(options.mainPaneWidth);

  const createPane = (config: PaneConfig, launch: LaunchSpec): Pane => {
    const target = targets.get(config.agent.name);
    if (!target) throw new Error(`No tmux pane provisioned for ${config.agent.name}`);
    tmux.setPaneTitle(target, config.agent.role);
    const command = [launch.command, ...launch.args].map(shq).join(' ');
    tmux.runLine(target, `cd ${shq(launch.cwd)} && ${command}`);
    return new TmuxPane(config.agent.name, tmux, target);
  };

  const engineOptions = { ...options, createPane };
  const engine = await TeamEngine.start(engineOptions);
  return { engine, tmux, attachCommand: tmux.attachCommand() };
}
