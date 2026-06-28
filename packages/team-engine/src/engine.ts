import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Broker } from './broker/broker';
import { ClaudeCodeAdapter } from './harness/claude-code';
import type { HarnessAdapter } from './harness/adapter';
import { ControlServer } from './mcp/control-server';
import { writeMcpConfig } from './mcp/mcp-config';
import { writePaneSettings } from './mcp/settings';
import type { Pane } from './pane/pane';
import { PtyPane } from './pane/pty-pane';
import { DEFAULT_TEAM, defaultAgentsDir, loadPersona, type RosterSlot } from './persona/persona';
import {
  ORCHESTRATOR_NAME,
  buildOrchestratorPersona,
  buildSpecialistPersona,
} from './persona/overlay';
import { loadModelMap, resolveAgentModel } from './persona/models';
import type { AgentSpec, LaunchSpec, PaneConfig, PermissionMode } from './types';
import { WorktreeManager, type WorktreeInfo } from './worktree/worktree';

/** Factory the engine uses to turn a launch spec into a running pane. */
export type PaneFactory = (config: PaneConfig, launch: LaunchSpec) => Pane;

export interface TeamEngineOptions {
  /** Git repo the team works on (the orchestrator pane's working directory). */
  readonly repoRoot: string;
  /** Specialist roster (default {@link DEFAULT_TEAM}). */
  readonly roster?: readonly RosterSlot[];
  /** Orchestrator pane persona (default {@link DEFAULT_ORCHESTRATOR_PERSONA}). */
  readonly orchestratorPersona?: string;
  /** Harness adapter (default Claude Code). Override with a fake for tests. */
  readonly adapter?: HarnessAdapter;
  /** Directory of canonical persona files (default auto-resolved). */
  readonly agentsDir?: string;
  /** Absolute path to the bundled MCP proxy (default auto-resolved). */
  readonly proxyPath?: string;
  /** Absolute path to the bundled Task-route hook (default auto-resolved). */
  readonly routeHookPath?: string;
  /** Fallback `config.yaml` for per-agent model resolution (a project-local one wins). */
  readonly configPath?: string;
  /** Model for the orchestrator/lead pane (default: the harness default). */
  readonly orchestratorModel?: string;
  readonly permissionMode?: PermissionMode;
  /** Per-specialist git worktrees (default) or all panes in the repo root. */
  readonly isolation?: 'worktree' | 'shared';
  /** Where generated team state (mcp-configs) lives (default `<repoRoot>/.software-teams/team`). */
  readonly stateDir?: string;
  /** Pane factory (default spawns a real {@link PtyPane}). Inject for tests. */
  readonly createPane?: PaneFactory;
}

/** A pane that can be told it went idle out-of-band (e.g. a Stop-hook signal). */
interface IdleSignalable {
  signalIdle(): void;
}

function hasSignalIdle(pane: Pane): pane is Pane & IdleSignalable {
  return typeof (pane as Partial<IdleSignalable>).signalIdle === 'function';
}

function findUp(start: string, rel: string): string | undefined {
  const visit = (dir: string): string | undefined => {
    if (existsSync(join(dir, rel))) return join(dir, rel);
    const parent = dirname(dir);
    return parent === dir ? undefined : visit(parent);
  };
  return visit(start);
}

/** Resolve the bundled proxy (`dist/mcp-proxy.mjs`) within the engine package. */
export function defaultProxyPath(): string {
  const found = findUp(dirname(fileURLToPath(import.meta.url)), join('dist', 'mcp-proxy.mjs'));
  if (!found) {
    throw new Error(
      'Could not locate dist/mcp-proxy.mjs. Run the engine `build:proxy`, or pass proxyPath explicitly.',
    );
  }
  return found;
}

/** Resolve the bundled Task-route hook (`dist/team-route-hook.mjs`). */
export function defaultRouteHookPath(): string {
  const found = findUp(dirname(fileURLToPath(import.meta.url)), join('dist', 'team-route-hook.mjs'));
  if (!found) {
    throw new Error(
      'Could not locate dist/team-route-hook.mjs. Run the engine `build:hook`, or pass routeHookPath explicitly.',
    );
  }
  return found;
}

const defaultPaneFactory: PaneFactory = (config, launch) =>
  PtyPane.spawn({
    name: config.agent.name,
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
  });

/**
 * Assembles and runs a live team: loads personas, provisions a worktree per
 * specialist, starts the broker + control server, generates each pane's mcp-config,
 * and spawns the panes wired to the bus. The lead (orchestrator) runs in the repo
 * root and edits directly; specialists run isolated and report back.
 */
export class TeamEngine {
  private constructor(
    readonly broker: Broker,
    readonly control: ControlServer,
    readonly panes: ReadonlyMap<string, Pane>,
    private readonly worktrees: readonly WorktreeInfo[],
    private readonly repoRoot: string,
  ) {}

  static async start(options: TeamEngineOptions): Promise<TeamEngine> {
    const adapter = options.adapter ?? new ClaudeCodeAdapter();
    const agentsDir = options.agentsDir ?? defaultAgentsDir();
    const roster = options.roster ?? DEFAULT_TEAM;
    const proxyPath = options.proxyPath ?? defaultProxyPath();
    const routeHookPath = options.routeHookPath ?? defaultRouteHookPath();
    const permissionMode = options.permissionMode ?? 'acceptEdits';
    const isolation = options.isolation ?? 'worktree';
    const stateDir = options.stateDir ?? join(options.repoRoot, '.software-teams', 'team');
    const createPane = options.createPane ?? defaultPaneFactory;

    const modelMap = loadModelMap({ repoRoot: options.repoRoot, configPath: options.configPath });
    const orchestratorModel = resolveAgentModel(
      ORCHESTRATOR_NAME,
      options.orchestratorModel,
      modelMap,
    );
    const specs: AgentSpec[] = [
      {
        name: ORCHESTRATOR_NAME,
        role: 'orchestrator',
        persona: options.orchestratorPersona ?? buildOrchestratorPersona(roster),
        isLead: true,
        ...(orchestratorModel ? { model: orchestratorModel } : {}),
      },
      ...roster.map((slot): AgentSpec => {
        const base = loadPersona(slot.agent, agentsDir);
        const model = resolveAgentModel(slot.agent, base.model, modelMap);
        return {
          name: slot.agent,
          role: slot.role,
          persona: buildSpecialistPersona(slot.agent, slot.role, base.persona),
          isLead: false,
          ...(model ? { model } : {}),
        };
      }),
    ];

    const wtManager = new WorktreeManager();
    const worktrees: WorktreeInfo[] = [];
    const cwdFor = (spec: AgentSpec): string => {
      if (spec.isLead || isolation === 'shared') return options.repoRoot;
      const info = wtManager.provision(spec.name, { repoRoot: options.repoRoot });
      worktrees.push(info);
      return info.path;
    };

    const broker = new Broker(adapter);
    const tokenToAgent = new Map<string, string>();
    const agentToken = new Map<string, string>();
    for (const spec of specs) {
      const token = randomUUID();
      tokenToAgent.set(token, spec.name);
      agentToken.set(spec.name, token);
    }

    const panes = new Map<string, Pane>();
    const control = new ControlServer({
      broker,
      tokens: tokenToAgent,
      onIdle: (agent) => {
        const pane = panes.get(agent);
        if (pane && hasSignalIdle(pane)) pane.signalIdle();
      },
    });
    await control.start();

    // If anything below throws (e.g. a pane fails to spawn), tear down what we
    // already started so we don't leak the bound control server or live panes.
    try {
      const mcpDir = join(stateDir, 'mcp');
      const personaDir = join(stateDir, 'personas');
      const settingsDir = join(stateDir, 'settings');
      mkdirSync(personaDir, { recursive: true });

      // The roster the Task-route hook consults: every agent running as a live pane.
      const rosterPath = join(stateDir, 'roster.json');
      writeFileSync(rosterPath, `${JSON.stringify(specs.map((spec) => spec.name), null, 2)}\n`);
      const taskRoute = { hookScript: routeHookPath, rosterPath };

      for (const spec of specs) {
        const token = agentToken.get(spec.name) ?? '';
        const mcpConfigPath = writeMcpConfig(mcpDir, spec.name, {
          proxyPath,
          controlUrl: control.url(),
          token,
        });
        const personaFile = join(personaDir, `${spec.name}.md`);
        writeFileSync(personaFile, spec.persona);
        const settingsPath = writePaneSettings(settingsDir, spec.name, {
          controlUrl: control.url(),
          token,
          taskRoute,
        });
        const config: PaneConfig = {
          agent: spec,
          cwd: cwdFor(spec),
          mcpConfigPath,
          personaFile,
          settingsPath,
          permissionMode,
          env: { ST_AGENT: spec.name },
        };
        const pane = createPane(config, adapter.buildLaunch(config));
        broker.registerPane(spec, pane);
        panes.set(spec.name, pane);
      }

      return new TeamEngine(broker, control, panes, worktrees, options.repoRoot);
    } catch (error) {
      await Promise.all([...panes.values()].map((pane) => pane.dispose().catch(() => undefined)));
      broker.dispose();
      await control.stop();
      throw error;
    }
  }

  /** Reset one pane's context (process survives). */
  clear(agent: string): void {
    this.broker.clear(agent);
  }

  /** Reset every pane's context. */
  clearAll(): void {
    this.broker.clearAll();
  }

  /** Stop the team: dispose panes, stop the control server, optionally remove worktrees. */
  async stop(opts: { removeWorktrees?: boolean } = {}): Promise<void> {
    await Promise.all([...this.panes.values()].map((pane) => pane.dispose()));
    await this.control.stop();
    this.broker.dispose();
    if (opts.removeWorktrees) {
      const manager = new WorktreeManager();
      for (const info of this.worktrees) manager.remove(info, this.repoRoot, true);
    }
  }
}
