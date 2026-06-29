import { spawnSync } from 'child_process';

function spawnTmux(args: string[]): boolean {
  const result = spawnSync('tmux', args, {
    stdio: 'pipe',
    timeout: 5000,
  });
  return result.status === 0;
}

export function isTmuxAvailable(): boolean {
  return spawnTmux(['-V']);
}

export function createTmuxSession(sessionName: string): boolean {
  return spawnTmux(['new-session', '-d', '-s', sessionName]);
}

export function createTmuxWindow(
  sessionName: string,
  windowName: string,
  command: string
): boolean {
  return spawnTmux([
    'new-window',
    '-t',
    sessionName,
    '-n',
    windowName,
    command,
  ]);
}

export function sendTmuxKeys(
  sessionName: string,
  windowTarget: string,
  keys: string
): boolean {
  return spawnTmux(['send-keys', '-t', `${sessionName}:${windowTarget}`, keys, 'C-m']);
}

export function renameTmuxWindow(
  sessionName: string,
  windowIndex: number,
  windowName: string
): void {
  spawnTmux(['rename-window', '-t', `${sessionName}:${windowIndex}`, windowName]);
}

export function killTmuxSession(sessionName: string): void {
  spawnTmux(['kill-session', '-t', sessionName]);
}

export interface TmuxContext {
  sessionName: string;
  nextWindowIndex: number;
}

export function initTmux(runId: string): TmuxContext | null {
  if (!isTmuxAvailable()) {
    console.log('tmux not found. Continuing without tmux.\n');
    return null;
  }

  const sessionName = `moreagent-${runId}`;

  if (!createTmuxSession(sessionName)) {
    console.log('Failed to create tmux session. Continuing without tmux.\n');
    return null;
  }

  renameTmuxWindow(sessionName, 0, 'controller');
  populateControllerWindow(sessionName);

  console.log(`tmux session: ${sessionName}`);
  console.log(`Attach: tmux attach -t ${sessionName}\n`);

  return { sessionName, nextWindowIndex: 1 };
}

function populateControllerWindow(sessionName: string): void {
  const lines = [
    '',
    '  MoreAgent tmux session',
    '',
    `  Session: ${sessionName}`,
    '',
    '  Navigation:',
    '    Ctrl+B n          next window',
    '    Ctrl+B p          previous window',
    '    Ctrl+B d          detach (agents keep running)',
    '',
    '  Inspect results:',
    '    moreagent status --latest',
    '    moreagent diff',
    '    moreagent inspect --agent reviewer',
    '',
    '  Agent windows tail stdout.log + stderr.log in real-time.',
    '',
  ];

  for (const line of lines.reverse()) {
    sendTmuxKeys(sessionName, '0', line);
  }
}

export function addAgentWindow(
  ctx: TmuxContext,
  windowName: string,
  stdoutPath: string,
  stderrPath: string
): void {
  const cmd =
    `while [ ! -f "${stdoutPath}" ] || [ ! -f "${stderrPath}" ]; do sleep 0.2; done; tail -f "${stdoutPath}" "${stderrPath}"`;

  createTmuxWindow(ctx.sessionName, windowName, cmd);
  ctx.nextWindowIndex++;
}
