import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readSessions } from '../session';
import { Run } from '../types';

export interface DiffOptions {
  run?: string;
}

export function diffCommand(options: DiffOptions = {}): void {
  const run = findRun(options.run);
  if (!run) {
    console.log('No runs found.');
    return;
  }

  const worktreePath = getWorktreePath(run);
  if (!worktreePath) {
    console.log(`Run ${run.id} has no worktree.`);
    console.log('No code-modifying agents were involved in this run.');
    return;
  }

  if (!fs.existsSync(worktreePath)) {
    console.log(`Worktree not found at: ${worktreePath}`);
    console.log('It may have been cleaned up or removed.');
    return;
  }

  console.log(`Run: ${run.id} (${run.status})`);
  console.log(`Task: ${run.task}`);
  console.log('');
  console.log('--- Worktree: git status ---');
  console.log(`(diff is from task worktree, NOT the main project)\n`);

  try {
    const status = execSync('git status --short', {
      cwd: worktreePath,
      encoding: 'utf-8',
    });
    console.log(status || '(no changes)');
  } catch (err: any) {
    console.log(`Error running git status: ${err.message}`);
  }

  console.log('--- Worktree: git diff --stat ---');
  try {
    const diffStat = execSync('git diff --stat', {
      cwd: worktreePath,
      encoding: 'utf-8',
    });
    console.log(diffStat || '(no diff)');
  } catch (err: any) {
    console.log(`Error running git diff: ${err.message}`);
    return;
  }

  console.log('--- Worktree: git diff ---');
  try {
    const diff = execSync('git diff', {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(diff || '(no diff)');
  } catch (err: any) {
    console.log(`Error running git diff: ${err.message}`);
  }
}

function findRun(runId?: string): Run | null {
  const data = readSessions();
  const runs = [...data.runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (runs.length === 0) {
    return null;
  }

  if (runId) {
    return runs.find((r) => r.id === runId || r.id.startsWith(runId)) || null;
  }

  return runs[0];
}

function getWorktreePath(run: Run): string | undefined {
  for (const session of run.sessions) {
    if (session.worktreePath && fs.existsSync(session.worktreePath)) {
      return session.worktreePath;
    }
  }
  return run.sessions.find((s) => s.worktreePath)?.worktreePath;
}
