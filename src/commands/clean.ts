import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getMoreAgentDir } from '../config';
import { resetSessions } from '../session';

export interface CleanOptions {
  cleanRuns: boolean;
  cleanWorktrees: boolean;
}

export function cleanCommand(options: CleanOptions): void {
  if (!options.cleanRuns && !options.cleanWorktrees) {
    printCleanHelp();
    return;
  }

  const moreAgentDir = getMoreAgentDir();
  const runsDir = path.join(moreAgentDir, 'runs');
  const worktreesDir = path.join(moreAgentDir, 'worktrees');

  if (options.cleanRuns) {
    cleanRunsDirectory(runsDir);
    resetSessions();
  }

  if (options.cleanWorktrees) {
    cleanWorktreesDirectory(worktreesDir);
  }

  console.log('Clean completed.');
}

function printCleanHelp(): void {
  console.log('Usage: moreagent clean [--runs | --worktrees | --all]');
  console.log('');
  console.log('Options:');
  console.log('  --runs       Remove .moreagent/runs and reset sessions.json');
  console.log('  --worktrees  Remove .moreagent/worktrees using git worktree remove');
  console.log('  --all        Clean both runs and worktrees');
}

function cleanRunsDirectory(runsDir: string): void {
  console.log(`Cleaning runs: ${runsDir}`);

  if (!fs.existsSync(runsDir)) {
    console.log('  Runs directory does not exist. Skipping.');
    return;
  }

  for (const entry of fs.readdirSync(runsDir)) {
    const entryPath = path.join(runsDir, entry);
    console.log(`  Removing: ${entryPath}`);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function cleanWorktreesDirectory(worktreesDir: string): void {
  console.log(`Cleaning worktrees: ${worktreesDir}`);

  if (!fs.existsSync(worktreesDir)) {
    console.log('  Worktrees directory does not exist. Skipping.');
    return;
  }

  const entries = fs.readdirSync(worktreesDir);
  if (entries.length === 0) {
    console.log('  No worktrees found.');
    return;
  }

  for (const entry of entries) {
    const worktreePath = path.join(worktreesDir, entry);
    console.log(`  Removing worktree: ${worktreePath}`);
    removeWorktree(worktreePath);
  }
}

function removeWorktree(worktreePath: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    return;
  } catch (err: any) {
    const message = extractCommandError(err);
    console.log(`    git worktree remove failed: ${message}`);
    console.log('    Try: git worktree prune');
  }
}

function extractCommandError(err: unknown): string {
  if (err && typeof err === 'object') {
    const error = err as {
      stderr?: Buffer | string;
      message?: string;
    };
    const stderr = error.stderr?.toString().trim();
    if (stderr) {
      return stderr;
    }
    if (error.message) {
      return error.message;
    }
  }

  return 'Unknown error';
}
