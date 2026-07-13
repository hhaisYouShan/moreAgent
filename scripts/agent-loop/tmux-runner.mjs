import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export function ensureTmuxSession(sessionName) {
  const hasSession = tmux(['has-session', '-t', sessionName]);
  if (hasSession.status === 0) return;

  const created = tmux(['new-session', '-d', '-s', sessionName, '-n', 'brain']);
  if (created.status !== 0) {
    throw new Error(`tmux new-session failed:\n${created.stderr || created.stdout}`);
  }
}

export function runInTmuxWindow({ sessionName, windowName, command }) {
  const result = tmux(['new-window', '-t', sessionName, '-n', windowName, command]);
  if (result.status !== 0) {
    throw new Error(`tmux new-window failed for ${windowName}:\n${result.stderr || result.stdout}`);
  }
}

export async function waitForStatusFiles(statusFiles, { pollMs = 3000, timeoutMs = 1000 * 60 * 60, logEveryMs = 15000, onStatus = null } = {}) {
  const started = Date.now();
  let lastLogAt = 0;
  const pending = new Set(statusFiles);
  const statuses = [];

  while (pending.size > 0) {
    for (const file of [...pending]) {
      if (!existsSync(file)) continue;
      const raw = await readFile(file, 'utf8');
      const status = JSON.parse(raw);
      statuses.push(status);
      pending.delete(file);
      console.log(`[agent-loop] received task status: ${file}`);
      if (onStatus) await onStatus(status, file);
    }

    if (pending.size === 0) break;

    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      throw new Error([
        `Timed out waiting for ${pending.size} task status file(s).`,
        'Pending status files:',
        ...[...pending].map((file) => `- ${file}`),
        'Open the corresponding Warp/tmux Agent window or inspect the task log under .agent-runs/ to see whether the child Agent is waiting, failed, or never started.',
      ].join('\n'));
    }

    if (Date.now() - lastLogAt >= logEveryMs) {
      lastLogAt = Date.now();
      const elapsedSeconds = Math.round(elapsed / 1000);
      console.log(`[agent-loop] waiting for ${pending.size}/${statusFiles.length} task status file(s)... elapsed ${elapsedSeconds}s`);
      for (const file of pending) console.log(`  pending: ${file}`);
    }

    await sleep(pollMs);
  }

  return statuses;
}

export function attachTmux(sessionName) {
  const result = spawnSync('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
  return result.status || 0;
}

function tmux(args) {
  return spawnSync('tmux', args, { encoding: 'utf8' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
