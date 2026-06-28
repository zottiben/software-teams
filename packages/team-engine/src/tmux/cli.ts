/**
 * Runnable entry for the tmux live-team demo.
 *
 * Bundled for Node (`build:tmux` → dist/launch-tmux.mjs). Usage:
 *   node dist/launch-tmux.mjs [repoRoot]
 * Then attach with the printed `tmux attach` command. Ctrl-C tears the team down.
 */
import { launchTmux } from './launch';

async function main(): Promise<void> {
  const repoRoot = process.argv[2] ?? process.cwd();
  const team = await launchTmux({ repoRoot, sessionName: process.env.ST_SESSION ?? 'software-teams' });

  process.stdout.write(
    [
      '',
      'Software Teams — live team started.',
      `  Orchestrator + ${team.engine.panes.size - 1} specialists are launching in tmux.`,
      '',
      `  Attach:  ${team.attachCommand}`,
      '  This process hosts the team bus — keep it running. Ctrl-C to stop.',
      '',
    ].join('\n'),
  );

  const shutdown = (): void => {
    void team.engine.stop().finally(() => {
      team.tmux.killSession();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Stay alive: the broker + control server must keep running for the panes.
  await new Promise<void>(() => undefined);
}

main().catch((error: unknown) => {
  process.stderr.write(`launch-tmux failed: ${String(error)}\n`);
  process.exit(1);
});
