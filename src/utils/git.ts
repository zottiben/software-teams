export async function exec(
  cmd: string[],
  cwd?: string,
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd: cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), exitCode };
}

export async function gitDiff(staged?: boolean): Promise<string> {
  const args = ["git", "diff"];
  if (staged) args.push("--cached");
  const { stdout } = await exec(args);
  return stdout;
}

export async function gitDiffNames(staged?: boolean): Promise<string[]> {
  const args = ["git", "diff", "--name-only"];
  if (staged) args.push("--cached");
  const { stdout } = await exec(args);
  return stdout ? stdout.split("\n") : [];
}

export async function gitLog(range?: string): Promise<string> {
  const args = ["git", "log", "--oneline"];
  if (range) args.push(range);
  else args.push("-20");
  const { stdout } = await exec(args);
  return stdout;
}

export async function gitBranch(): Promise<string> {
  const { stdout } = await exec(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout;
}

export async function gitRoot(): Promise<string> {
  const { stdout } = await exec(["git", "rev-parse", "--show-toplevel"]);
  return stdout;
}

export async function gitStatus(): Promise<string> {
  const { stdout } = await exec(["git", "status", "--porcelain"]);
  return stdout;
}

export async function gitMergeBase(branch: string): Promise<string> {
  const { stdout } = await exec(["git", "merge-base", "HEAD", branch]);
  return stdout;
}
