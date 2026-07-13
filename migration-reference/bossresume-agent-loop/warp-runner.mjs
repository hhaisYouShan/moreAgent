import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function runInWarpWindow({ runDir, windowName, command }) {
  const launchDir = path.join(runDir, 'warp-windows');
  await mkdir(launchDir, { recursive: true });

  const scriptPath = path.join(launchDir, `${safeFileName(windowName)}.command`);
  const script = `#!/usr/bin/env bash
printf '\\033]0;${escapeTitle(windowName)}\\007'
${command}
`;

  await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o755 });

  const result = spawnSync('open', ['-a', 'Warp', scriptPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Warp launch failed for ${windowName}:\n${result.stderr || result.stdout}`);
  }

  return { scriptPath };
}

function safeFileName(value) {
  return String(value || 'agent')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

function escapeTitle(value) {
  return String(value || 'agent').replace(/[\\`$!"]/g, '');
}
