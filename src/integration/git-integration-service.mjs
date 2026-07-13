import { spawnSync } from 'node:child_process';

export function createGitIntegrationService({ runGit = defaultRunGit, runCommand = defaultRunCommand, now = () => new Date().toISOString() } = {}) {
  return Object.freeze({
    async integrate({
      projectId,
      workflowId,
      projectRoot,
      baseCommit,
      taskCommits,
      integrationBranch,
      integrationWorktreePath,
      verificationCommands = [],
      requirementIds = [],
      cleanupWorktree = false,
    } = {}) {
      for (const [name, value] of Object.entries({ projectId, workflowId, projectRoot, baseCommit, integrationBranch, integrationWorktreePath })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      if (!Array.isArray(taskCommits) || !taskCommits.length) throw new TypeError('taskCommits must be a non-empty array');
      const uniqueCommits = [...new Set(taskCommits)];
      if (uniqueCommits.length !== taskCommits.length) throw integrationError('DUPLICATE_TASK_COMMIT', 'taskCommits contains duplicates.');

      const startedAt = timestamp(now);
      const conflicts = [];
      const mergeResults = [];
      let integrationCommit = null;
      let changedFiles = [];
      let setupComplete = false;

      try {
        const setup = runGit({
          cwd: projectRoot,
          args: ['worktree', 'add', '-B', integrationBranch, integrationWorktreePath, baseCommit],
        });
        if (setup.exitCode !== 0) throw integrationError('INTEGRATION_WORKTREE_CREATE_FAILED', setup.stderr || setup.stdout || 'Failed to create integration worktree.');
        setupComplete = true;

        for (const commit of uniqueCommits) {
          const merge = runGit({
            cwd: integrationWorktreePath,
            args: ['merge', '--no-ff', '--no-edit', commit],
          });
          mergeResults.push(Object.freeze({ commit, exitCode: merge.exitCode, stdout: merge.stdout, stderr: merge.stderr }));
          if (merge.exitCode === 0) continue;

          const unresolved = runGit({ cwd: integrationWorktreePath, args: ['diff', '--name-only', '--diff-filter=U'] });
          conflicts.push(Object.freeze({
            taskCommit: commit,
            files: Object.freeze(splitLines(unresolved.stdout)),
            message: merge.stderr || merge.stdout || 'merge_conflict',
          }));
          runGit({ cwd: integrationWorktreePath, args: ['merge', '--abort'] });
          break;
        }

        if (!conflicts.length) {
          const head = runGit({ cwd: integrationWorktreePath, args: ['rev-parse', 'HEAD'] });
          if (head.exitCode !== 0 || !head.stdout) throw integrationError('INTEGRATION_HEAD_UNAVAILABLE', head.stderr || 'Failed to resolve integration commit.');
          integrationCommit = head.stdout.trim();
          const diff = runGit({ cwd: integrationWorktreePath, args: ['diff', '--name-only', `${baseCommit}..${integrationCommit}`] });
          if (diff.exitCode !== 0) throw integrationError('INTEGRATION_DIFF_FAILED', diff.stderr || 'Failed to calculate integration diff.');
          changedFiles = splitLines(diff.stdout);
        }

        const verificationResults = [];
        if (!conflicts.length) {
          for (const specification of verificationCommands) {
            const executedAt = timestamp(now);
            const result = await runCommand({ ...specification, cwd: specification.cwd || integrationWorktreePath });
            verificationResults.push(Object.freeze({
              verificationId: specification.verificationId || `verify-${verificationResults.length + 1}`,
              command: formatCommand(specification),
              cwd: specification.cwd || integrationWorktreePath,
              exitCode: result.exitCode,
              environment: specification.environment || 'integration',
              commitSha: integrationCommit,
              executedAt,
              logPath: specification.logPath || `logs/integration/${workflowId}-${verificationResults.length + 1}.log`,
              result: result.exitCode === 0 ? 'PASS' : 'FAIL',
              stdout: result.stdout,
              stderr: result.stderr,
            }));
          }
        }

        const passed = !conflicts.length && verificationResults.every((result) => result.exitCode === 0);
        return Object.freeze({
          passed,
          failureReason: conflicts.length ? 'integration_conflict' : passed ? null : 'integration_verification_failed',
          evidence: Object.freeze({
            schemaVersion: '1.0',
            entityType: 'INTEGRATION_EVIDENCE',
            integrationEvidenceId: `integration-${workflowId}-${Date.parse(startedAt)}`,
            projectId,
            workflowId,
            baseCommit,
            taskCommits: Object.freeze(uniqueCommits),
            integrationBranch,
            integrationCommit,
            conflicts: Object.freeze(conflicts),
            mergeResults: Object.freeze(mergeResults),
            verificationResults: Object.freeze(verificationResults),
            changedFiles: Object.freeze(changedFiles),
            requirementIds: Object.freeze([...new Set(requirementIds)].sort()),
            createdAt: timestamp(now),
          }),
        });
      } finally {
        if (setupComplete && cleanupWorktree) {
          runGit({ cwd: projectRoot, args: ['worktree', 'remove', '--force', integrationWorktreePath] });
          runGit({ cwd: projectRoot, args: ['worktree', 'prune', '--expire', 'now'] });
        }
      }
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

function defaultRunCommand({ command, args = [], cwd, env = {} }) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: false });
  return Promise.resolve({
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  });
}

function formatCommand(specification) {
  return [specification.command, ...(specification.args || [])].join(' ');
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function integrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
