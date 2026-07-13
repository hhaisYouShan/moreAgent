import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CODE_PREFIXES = ['client/', 'server/', 'tests/', 'e2e/'];
const TEST_CONFIG_PREFIXES = ['playwright.config.', 'vitest.config.', 'jest.config.'];

export function collectCodeIntegration({ tasks, worktrees }) {
  const result = new Map();
  const changedByFile = new Map();

  for (const task of tasks) {
    const worktree = worktrees.get(task.id);
    const integration = { files: [], conflicts: [], unsupported: [] };
    result.set(task.id, integration);

    if (!worktree || !task.allowCodeChanges) continue;

    for (const entry of gitChangedFiles(worktree.worktreePath).filter((item) => isCodeFile(item.file))) {
      if (entry.status.includes('D')) {
        integration.unsupported.push(entry.file);
        continue;
      }

      integration.files.push(entry.file);
      const owners = changedByFile.get(entry.file) || [];
      owners.push(task.id);
      changedByFile.set(entry.file, owners);
    }
  }

  for (const [file, owners] of changedByFile.entries()) {
    if (owners.length <= 1) continue;
    for (const taskId of owners) {
      const integration = result.get(taskId);
      integration.conflicts.push(file);
    }
  }

  return result;
}

export async function syncApprovedCodeChangesToRepo({ repoRoot, tasks, worktrees, codeIntegration }) {
  const copied = [];

  for (const task of tasks) {
    if (!task.allowCodeChanges) continue;
    const worktree = worktrees.get(task.id);
    const integration = codeIntegration.get(task.id) || { files: [] };

    for (const file of integration.files || []) {
      const source = path.join(worktree.worktreePath, file);
      const target = path.join(repoRoot, file);
      if (!existsSync(source)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      copied.push(file);
    }
  }

  return unique(copied);
}

export async function syncApprovedCodeChangesToIntegrationBranch({ repoRoot, tasks, worktrees, codeIntegration, featureKey }) {
  const changedTasks = tasks
    .filter((task) => task.allowCodeChanges)
    .map((task) => ({ task, worktree: worktrees.get(task.id), integration: codeIntegration.get(task.id) || { files: [] } }))
    .filter((item) => item.worktree && item.integration.files?.length);

  if (!changedTasks.length) return null;

  const safeFeatureKey = sanitizeRef(featureKey || 'agent-loop');
  const branch = `agent/integration/${safeFeatureKey}`;
  const worktreePath = path.join(repoRoot, '.agent-worktrees', `integration-${safeFeatureKey}`);
  const mergedBranches = [];
  const conflicts = [];
  const skipped = [];

  await ensureIntegrationWorktree({ repoRoot, worktreePath, branch });

  for (const { task, worktree, integration } of changedTasks) {
    const committed = commitWorktreeChanges({ worktreePath: worktree.worktreePath, files: integration.files, message: `agent-loop: integrate ${task.agent} ${task.id}` });
    if (!committed.ok) {
      skipped.push({ task: task.id, branch: worktree.branch, reason: committed.reason });
      continue;
    }

    const mergeResult = git(worktreePath, ['merge', '--no-ff', '--no-edit', worktree.branch]);
    if (mergeResult.status !== 0) {
      conflicts.push({ task: task.id, branch: worktree.branch, message: mergeResult.stderr || mergeResult.stdout });
      git(worktreePath, ['merge', '--abort']);
      continue;
    }
    mergedBranches.push(worktree.branch);
  }

  return {
    branch,
    worktreePath: path.relative(repoRoot, worktreePath),
    mergedBranches: unique(mergedBranches),
    conflicts,
    skipped,
  };
}

export async function syncRootCodeChangesToWorktree({ repoRoot, worktreePath }) {
  const copied = [];

  for (const entry of gitChangedFiles(repoRoot).filter((item) => isCodeFile(item.file))) {
    const source = path.join(repoRoot, entry.file);
    const target = path.join(worktreePath, entry.file);

    if (entry.status.includes('D')) {
      await rm(target, { force: true, recursive: true });
      copied.push(entry.file);
      continue;
    }

    if (!existsSync(source)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(entry.file);
  }

  return unique(copied);
}

export function shouldPreloadIntegratedCode(task) {
  const phase = String(task.phase || '').toUpperCase();
  return ['TESTING', 'PRODUCT_ACCEPTANCE', 'USER_ACCEPTANCE'].includes(phase);
}

async function ensureIntegrationWorktree({ repoRoot, worktreePath, branch }) {
  await mkdir(path.dirname(worktreePath), { recursive: true });
  if (existsSync(worktreePath)) return;

  const branchExists = git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
  const args = branchExists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, currentBranch(repoRoot) || 'master'];
  const result = git(repoRoot, args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
}

function commitWorktreeChanges({ worktreePath, files, message }) {
  const existingFiles = files.filter((file) => existsSync(path.join(worktreePath, file)));
  if (!existingFiles.length) return { ok: false, reason: 'no existing changed files to commit' };

  const addResult = git(worktreePath, ['add', ...existingFiles]);
  if (addResult.status !== 0) return { ok: false, reason: addResult.stderr || addResult.stdout || 'git add failed' };

  const staged = git(worktreePath, ['diff', '--cached', '--name-only']).stdout.trim();
  if (!staged) return { ok: true, reason: 'already committed or no staged changes' };

  const commitResult = git(worktreePath, ['-c', 'user.name=Agent Loop', '-c', 'user.email=agent-loop@example.local', 'commit', '-m', message]);
  if (commitResult.status !== 0) return { ok: false, reason: commitResult.stderr || commitResult.stdout || 'git commit failed' };
  return { ok: true };
}

function gitChangedFiles(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawFile = line.slice(3).trim();
      const file = rawFile.includes(' -> ') ? rawFile.split(' -> ').pop().trim() : rawFile;
      return { status, file };
    })
    .filter((entry) => entry.file);
}

function currentBranch(repoRoot) {
  const result = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.status !== 0) return null;
  const branch = result.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : null;
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function isCodeFile(file) {
  const value = String(file || '');
  return CODE_PREFIXES.some((prefix) => value.startsWith(prefix)) || TEST_CONFIG_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function sanitizeRef(value) {
  return String(value || 'agent-loop').trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-loop';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
