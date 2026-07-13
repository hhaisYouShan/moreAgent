import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REQUIRED_PROTOCOL_FILES = [
  'AGENTS.md',
  'docs/README.md',
  'agent-loop-docs/README.md',
  'agent-loop-docs/process/workflow-state.md',
  'agent-loop-docs/process/prd-review-standard.md',
  'agent-loop-docs/process/completion-status.md',
  'agent-loop-docs/process/brain-loop-protocol.md',
  'agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md',
];

const PROTOCOL_CONTEXT_DIRS = [
  'agent-loop-docs/reviews',
  'agent-loop-docs/gate-results',
  'agent-loop-docs/decisions',
  'agent-loop-docs/issues',
  'agent-loop-docs/tech',
  'agent-loop-docs/test-reports',
  'agent-loop-docs/acceptance',
];

const PROCESS_CONTEXT_FILES = [
  'agent-loop-docs/process/workflow-state.json',
  'agent-loop-docs/process/round-context.json',
  'agent-loop-docs/process/workflow-state.md',
  'agent-loop-docs/process/confirmed-decisions.json',
  'agent-loop-docs/process/agent-loop-dashboard.md',
  'agent-loop-docs/process/completion-status.md',
  'agent-loop-docs/process/last-sync-report.md',
  'agent-loop-docs/process/audit-events.jsonl',
  'agent-loop-docs/process/brain-conversation.jsonl',
  'agent-loop-docs/process/brain-discussion.md',
];

// fresh worktree reset uses git worktree remove and branch -D.
export async function ensureWorktree({ repoRoot, task, baseBranch, fresh = false }) {
  const worktreeRoot = path.join(repoRoot, '.agent-worktrees');
  await mkdir(worktreeRoot, { recursive: true });

  const worktreePath = path.join(worktreeRoot, task.id);
  const branch = `agent/${task.id}`;
  const base = baseBranch || currentBranch(repoRoot) || 'master';

  if (fresh) await resetExistingWorktree({ repoRoot, worktreePath, branch });

  if (existsSync(worktreePath)) {
    await syncWorktreeProtocolInputs({ repoRoot, worktreePath, task });
    const validation = validateWorktreeProtocol({ worktreePath, task });
    if (validation.ok) return { worktreePath, branch, created: false, fresh: false };

    console.log('[agent-loop] stale worktree detected. Resetting before task launch.');
    console.log(`- worktree: ${path.relative(repoRoot, worktreePath)}`);
    console.log(`- missing: ${validation.missing.join(', ')}`);
    await resetExistingWorktree({ repoRoot, worktreePath, branch });
  }

  let created = await addWorktree({ repoRoot, worktreePath, branch, base });
  await syncWorktreeProtocolInputs({ repoRoot, worktreePath, task });
  let validation = validateWorktreeProtocol({ worktreePath, task });

  if (!validation.ok) {
    console.log('[agent-loop] worktree branch does not match current Agent Loop protocol. Recreating from base branch.');
    console.log(`- worktree: ${path.relative(repoRoot, worktreePath)}`);
    console.log(`- branch: ${branch}`);
    console.log(`- base: ${base}`);
    console.log(`- missing: ${validation.missing.join(', ')}`);

    await resetExistingWorktree({ repoRoot, worktreePath, branch });
    created = await addWorktree({ repoRoot, worktreePath, branch, base, forceNewBranch: true });
    await syncWorktreeProtocolInputs({ repoRoot, worktreePath, task });
    validation = validateWorktreeProtocol({ worktreePath, task });
  }

  if (!validation.ok) {
    throw new Error([
      'Created worktree is missing required Agent Loop protocol files.',
      `Worktree: ${worktreePath}`,
      `Base: ${base}`,
      'Missing files:',
      ...validation.missing.map((file) => `- ${file}`),
      'Run `git pull` in the main repo, then rerun `/next --fresh-worktree`. If the missing files are generated local Agent Loop artifacts, ensure they exist in the main repo working tree.',
    ].join('\n'));
  }

  return { worktreePath, branch, created, fresh };
}

async function addWorktree({ repoRoot, worktreePath, branch, base, forceNewBranch = false }) {
  const args = !forceNewBranch && branchExists(repoRoot, branch)
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, base];

  const result = git(repoRoot, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }

  return true;
}

async function resetExistingWorktree({ repoRoot, worktreePath, branch }) {
  if (existsSync(worktreePath)) {
    const removeResult = git(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    if (removeResult.status !== 0) await rm(worktreePath, { recursive: true, force: true });
  }

  if (!branchExists(repoRoot, branch)) return;

  const deleteResult = git(repoRoot, ['branch', '-D', branch]);
  if (deleteResult.status !== 0) {
    throw new Error(`git branch -D ${branch} failed:\n${deleteResult.stderr || deleteResult.stdout}`);
  }
}

async function syncWorktreeProtocolInputs({ repoRoot, worktreePath, task }) {
  const required = collectRequiredPaths(task);

  for (const relativePath of required) {
    await copyProtocolPathIfPresent({ repoRoot, worktreePath, relativePath, overwrite: true });
  }

  for (const relativePath of PROCESS_CONTEXT_FILES) {
    await copyProtocolPathIfPresent({ repoRoot, worktreePath, relativePath, overwrite: true });
  }

  for (const relativeDir of PROTOCOL_CONTEXT_DIRS) {
    await copyProtocolDirectory({ repoRoot, worktreePath, relativeDir });
  }
}

async function copyProtocolPathIfPresent({ repoRoot, worktreePath, relativePath, overwrite = false }) {
  const targetPath = path.join(worktreePath, relativePath);
  const sourcePath = path.join(repoRoot, relativePath);

  try {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      return;
    }
    if (sourceStat.isFile()) {
      if (!overwrite && existsSync(targetPath)) return;
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  } catch {
    if (looksLikeDirectory(relativePath)) await mkdir(targetPath, { recursive: true });
  }
}

async function copyProtocolDirectory({ repoRoot, worktreePath, relativeDir }) {
  const sourceDir = path.join(repoRoot, relativeDir);
  const targetDir = path.join(worktreePath, relativeDir);
  if (!existsSync(sourceDir)) return;
  await mkdir(targetDir, { recursive: true });

  for (const item of await readdir(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, item.name);
    const target = path.join(targetDir, item.name);
    if (item.isDirectory()) {
      await copyProtocolDirectory({ repoRoot, worktreePath, relativeDir: path.join(relativeDir, item.name) });
      continue;
    }
    if (!item.isFile()) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

function validateWorktreeProtocol({ worktreePath, task }) {
  const required = collectRequiredPaths(task);
  const missing = required.filter((file) => !existsSync(path.join(worktreePath, file)));
  return { ok: missing.length === 0, missing };
}

function collectRequiredPaths(task) {
  return unique([
    ...REQUIRED_PROTOCOL_FILES,
    task?.agentPromptPath,
    task?.gateResultFile ? path.dirname(task.gateResultFile) : null,
    ...(task?.outputFiles || []).map((file) => path.dirname(file)),
    ...(task?.inputFiles || []),
    ...(task?.editableFiles || []),
  ].filter(Boolean).filter(isConcretePath));
}

function looksLikeDirectory(file) {
  const value = String(file || '');
  return value.endsWith('/') || !path.extname(value);
}

function isConcretePath(file) {
  const value = String(file || '');
  return value && !/[!*?[\]{}]/.test(value);
}

function branchExists(repoRoot, branch) {
  return git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
