import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { WorkspaceType } from '../../src/domain/enums.mjs';

export function createGitWorktreeProvider({
  providerId = 'git-worktree',
  projectRoot,
  worktreeRoot,
  branchPrefix = 'agent/task',
  runGit = defaultRunGit,
} = {}) {
  if (!projectRoot) throw new TypeError('projectRoot is required');
  if (!worktreeRoot) throw new TypeError('worktreeRoot is required');

  return Object.freeze({
    providerId,
    workspaceType: WorkspaceType.WORKTREE,

    async create({ workspaceId, taskId, baseCommit, branch }) {
      const worktreePath = path.resolve(projectRoot, worktreeRoot, workspaceId);
      const taskBranch = branch || `${branchPrefix}/${sanitize(taskId)}`;
      const result = runGit({ cwd: projectRoot, args: ['worktree', 'add', '-b', taskBranch, worktreePath, baseCommit] });
      if (result.exitCode !== 0) throw workspaceError('WORKTREE_CREATE_FAILED', result.stderr || result.stdout || `Failed to create ${worktreePath}.`);
      return {
        path: worktreePath,
        branch: taskBranch,
        metadata: {
          stdout: result.stdout,
          baseCommit,
        },
      };
    },

    async release({ workspace, force = false }) {
      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(workspace.path);
      const result = runGit({ cwd: projectRoot, args });
      if (result.exitCode !== 0) throw workspaceError('WORKTREE_REMOVE_FAILED', result.stderr || result.stdout || `Failed to remove ${workspace.path}.`);
      const prune = runGit({ cwd: projectRoot, args: ['worktree', 'prune', '--expire', 'now'] });
      if (prune.exitCode !== 0) throw workspaceError('WORKTREE_PRUNE_FAILED', prune.stderr || prune.stdout || 'Failed to prune worktrees.');
    },
  });
}

function defaultRunGit({ cwd, args }) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function sanitize(value) {
  return String(value || 'task').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
}

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
