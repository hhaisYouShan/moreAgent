import * as fs from 'fs';
import { execSync } from 'child_process';
import { readSessions, updateRun } from '../session';
import { Run } from '../types';

export interface MergeOptions {
  run?: string;
  latest?: boolean;
  dryRun?: boolean;
  apply?: boolean;
}

export function mergeCommand(options: MergeOptions): void {
  const run = findRun(options);
  if (!run) {
    console.log('No runs found.');
    return;
  }

  if (run.status !== 'completed') {
    throw new Error(
      `Run ${run.id} is ${run.status}. Only completed runs can be merged.`
    );
  }

  const worktreePath = getWorktreePath(run);
  if (!worktreePath) {
    throw new Error(`Run ${run.id} has no worktree. Nothing to merge.`);
  }
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Worktree not found at: ${worktreePath}`);
  }

  const branch = getWorktreeBranch(worktreePath);
  if (!branch) {
    throw new Error('Could not determine worktree branch.');
  }

  const mainStatus = getMainStatus();
  if (mainStatus !== '') {
    throw new Error(
      'Main project has uncommitted changes. Please commit or stash them first.\n' +
        `  git status: ${mainStatus}`
    );
  }

  if (options.apply) {
    const hasCommits = worktreeHasCommitsAhead(worktreePath, branch);
    if (!hasCommits) {
      console.log('');
      console.log('Worktree has no committed changes on the branch.');
      console.log('To apply changes, first commit them in the worktree:');
      console.log('');
      console.log('Option A (commit + merge):');
      console.log(`  cd "${worktreePath}"`);
      console.log('  git add .');
      console.log('  git commit -m "Apply MoreAgent changes"');
      console.log(`  cd "${process.cwd()}"`);
      console.log(`  moreagent merge --run ${run.id} --apply`);
      console.log('');
      console.log('Option B (patch):');
      console.log(`  cd "${worktreePath}"`);
      console.log('  git add .');
      console.log(`  git diff --cached > /tmp/moreagent.patch`);
      console.log(`  cd "${process.cwd()}"`);
      console.log('  git apply /tmp/moreagent.patch');
      console.log('');
      console.log('Note: untracked files are NOT included in git diff/patch.');
      return;
    }

    try {
      execSync(`git merge "${branch}" --no-edit`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      const commitHash = getHeadCommit();
      console.log(`\nMerged branch "${branch}" into current branch.`);
      console.log(`Merge commit: ${commitHash}`);

      run.mergedAt = new Date().toISOString();
      run.mergedBranch = branch;
      run.mergeCommit = commitHash;
      updateRun(run);
    } catch (err: any) {
      throw new Error(`Merge failed: ${err.message}`);
    }
    return;
  }

  // Dry-run
  console.log(`Run: ${run.id} (${run.task})`);
  console.log(`Status: ${run.status}`);
  console.log(`Worktree: ${worktreePath}`);
  console.log(`Branch: ${branch}`);
  console.log('');

  const diffStat = getWorktreeDiffStat(worktreePath);
  console.log('--- Diff Summary ---');
  console.log(diffStat || '(no changes)');
  console.log('');

  const wtChanged = getWorktreeChangedFiles(worktreePath);
  const wtUntracked = getWorktreeUntrackedFiles(worktreePath);

  if (wtUntracked) {
    console.log('Warning: worktree has untracked files:');
    console.log(wtUntracked);
    console.log('These will NOT be merged. Commit them in the worktree first.');
    console.log('');
  }

  if (!wtChanged && !wtUntracked) {
    console.log('No changes to merge.');
    return;
  }

  console.log('To apply these changes:');
  console.log('');
  if (wtUntracked) {
    console.log(`  cd "${worktreePath}"`);
    console.log('  git add .');
    console.log('  git commit -m "Apply MoreAgent changes"');
    console.log(`  cd "${process.cwd()}"`);
  }
  console.log(`  moreagent merge --run ${run.id} --apply`);
  console.log('');
  console.log('Or manually:');
  console.log(`  cd "${worktreePath}"`);
  console.log('  git add . && git commit -m "..."');
  console.log(`  cd "${process.cwd()}"`);
  console.log(`  git merge ${branch}`);
}

function findRun(options: MergeOptions): Run | null {
  const data = readSessions();
  const runs = [...data.runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (runs.length === 0) return null;

  if (options.run) {
    const needle = options.run;
    return runs.find((r) => r.id === needle || r.id.startsWith(needle)) ?? null;
  }

  return runs[0];
}

function getWorktreePath(run: Run): string | null {
  for (const s of run.sessions) {
    if (s.worktreePath && fs.existsSync(s.worktreePath)) {
      return s.worktreePath;
    }
  }
  return run.sessions.find((s) => s.worktreePath)?.worktreePath ?? null;
}

function getWorktreeBranch(worktreePath: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

function getMainStatus(): string {
  try {
    return execSync('git status --porcelain', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function getWorktreeDiffStat(worktreePath: string): string {
  try {
    return execSync('git diff HEAD --stat', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function getWorktreeChangedFiles(worktreePath: string): string {
  try {
    return execSync('git diff HEAD --name-only', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function getWorktreeUntrackedFiles(worktreePath: string): string {
  try {
    return execSync('git ls-files --others --exclude-standard', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function worktreeHasCommitsAhead(worktreePath: string, branch: string): boolean {
  try {
    const base = execSync(
      `git merge-base HEAD "${branch}"`,
      { cwd: worktreePath, encoding: 'utf-8' }
    ).trim();
    const diff = execSync(`git diff ${base}..HEAD --stat`, {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
    return diff.length > 0;
  } catch {
    return false;
  }
}

function getHeadCommit(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}
