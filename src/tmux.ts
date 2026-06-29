import { execSync } from 'child_process';

export function isTmuxAvailable(): boolean {
  try {
    execSync('command -v tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function createTmuxSession(sessionName: string): boolean {
  try {
    execSync(`tmux new-session -d -s "${sessionName}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function createTmuxWindow(
  sessionName: string,
  windowName: string,
  command: string
): boolean {
  try {
    const escaped = command.replace(/'/g, "'\\''");
    execSync(
      `tmux new-window -t "${sessionName}" -n "${windowName}" "${escaped}"`,
      { stdio: 'pipe' }
    );
    return true;
  } catch {
    return false;
  }
}

export function renameTmuxWindow(
  sessionName: string,
  windowIndex: number,
  windowName: string
): void {
  try {
    execSync(
      `tmux rename-window -t "${sessionName}:${windowIndex}" "${windowName}"`,
      { stdio: 'pipe' }
    );
  } catch {
    // best-effort
  }
}

export function killTmuxSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' });
  } catch {
    // already dead
  }
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

  console.log(`tmux session: ${sessionName}`);
  console.log(`Attach: tmux attach -t ${sessionName}\n`);

  return { sessionName, nextWindowIndex: 1 };
}

export function addAgentWindow(
  ctx: TmuxContext,
  windowName: string,
  stdoutPath: string,
  stderrPath: string
): void {
  const cmd = `tail -f "${stdoutPath}" "${stderrPath}" 2>/dev/null`;
  createTmuxWindow(ctx.sessionName, windowName, cmd);
  ctx.nextWindowIndex++;
}
