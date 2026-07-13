import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function listWorktrees({ projectRoot, adapter, activeTaskIds = [] }) {
  const result = git(projectRoot, ['worktree', 'list', '--porcelain']);
  if (result.status !== 0) return { entries: [], prunable: [], orphan: [], error: result.stderr.trim() };
  const entries = parsePorcelain(result.stdout);
  const root = path.resolve(projectRoot, adapter.paths.agentWorktrees);
  const active = new Set(activeTaskIds.map(String));
  const orphan = entries.filter((entry) => entry.worktree && path.resolve(entry.worktree).startsWith(`${root}${path.sep}`) && !active.has(path.basename(entry.worktree)));
  return { entries, prunable: entries.filter((entry) => entry.prunable), orphan };
}

export function createWorktree({ projectRoot, worktreePath, ref = 'HEAD', branch = null }) {
  const args = ['worktree', 'add'];
  if (branch) args.push('-b', branch);
  args.push(worktreePath, ref);
  return commandResult(git(projectRoot, args));
}

export function removeWorktree({ projectRoot, worktreePath }) { return commandResult(git(projectRoot, ['worktree', 'remove', worktreePath])); }
export function pruneWorktrees({ projectRoot }) { return commandResult(git(projectRoot, ['worktree', 'prune', '--expire', 'now'])); }

function git(cwd, args) { return spawnSync('git', args, { cwd, encoding: 'utf8' }); }
function commandResult(result) { return { exitCode: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() }; }
function parsePorcelain(text) { const entries = []; let entry = {}; for (const line of text.split(/\r?\n/)) { if (!line.trim()) { if (Object.keys(entry).length) entries.push(entry); entry = {}; continue; } const [key, ...rest] = line.split(' '); entry[key] = rest.join(' ') || true; } if (Object.keys(entry).length) entries.push(entry); return entries; }
