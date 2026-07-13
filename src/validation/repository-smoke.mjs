import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGitIntegrationService } from '../integration/git-integration-service.mjs';

export async function runRepositorySmoke({
  projectRoot,
  projectId,
  workflowId,
  prdPath,
  allowedValidationPath = '.moreagent-validation',
  outputPath = null,
  now = () => new Date().toISOString(),
  runGit = defaultRunGit,
  runCommand = defaultRunCommand,
} = {}) {
  for (const [name, value] of Object.entries({ projectRoot, projectId, workflowId, prdPath })) {
    if (!value) throw new TypeError(`${name} is required`);
  }
  const root = path.resolve(projectRoot);
  const initialStatus = runGit({ cwd: root, args: ['status', '--porcelain'] });
  assertGit(initialStatus, 'SMOKE_GIT_STATUS_FAILED');
  if (initialStatus.stdout.trim()) throw smokeError('SMOKE_REPOSITORY_DIRTY', 'Repository must be clean before validation smoke.');

  const head = runGit({ cwd: root, args: ['rev-parse', 'HEAD'] });
  assertGit(head, 'SMOKE_BASE_COMMIT_FAILED');
  const baseCommit = head.stdout.trim();
  const prdAbsolutePath = resolveInside(root, prdPath);
  const prdContent = await readFile(prdAbsolutePath, 'utf8');
  const prdHash = hashText(prdContent);
  const startedAt = timestamp(now);
  const suffix = createHash('sha256').update(`${workflowId}:${baseCommit}:${startedAt}`).digest('hex').slice(0, 10);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `moreagent-${projectId}-`));
  const taskWorktreePath = path.join(tempRoot, 'task');
  const integrationWorktreePath = path.join(tempRoot, 'integration');
  const taskBranch = `validation/${sanitize(projectId)}-smoke-${suffix}`;
  const integrationBranch = `validation/${sanitize(projectId)}-integration-${suffix}`;
  let taskCommit = null;
  let integrationResult = null;
  const cleanup = [];

  try {
    const addWorktree = runGit({ cwd: root, args: ['worktree', 'add', '-b', taskBranch, taskWorktreePath, baseCommit] });
    assertGit(addWorktree, 'SMOKE_TASK_WORKTREE_CREATE_FAILED');

    const validationDirectory = resolveInside(taskWorktreePath, allowedValidationPath);
    await mkdir(validationDirectory, { recursive: true });
    const markerRelativePath = normalize(path.join(allowedValidationPath, 'stage7-smoke.json'));
    const marker = {
      schemaVersion: '1.0',
      artifactType: 'REAL_PROJECT_VALIDATION_MARKER',
      projectId,
      workflowId,
      baseCommit,
      prdPath,
      prdHash,
      createdAt: timestamp(now),
      constraints: {
        businessCodeModified: false,
        remotePushAllowed: false,
        productionDataAllowed: false,
      },
    };
    await writeFile(resolveInside(taskWorktreePath, markerRelativePath), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

    assertGit(runGit({ cwd: taskWorktreePath, args: ['config', 'user.name', 'MoreAgent Validation'] }), 'SMOKE_GIT_CONFIG_FAILED');
    assertGit(runGit({ cwd: taskWorktreePath, args: ['config', 'user.email', 'validation@moreagent.local'] }), 'SMOKE_GIT_CONFIG_FAILED');
    assertGit(runGit({ cwd: taskWorktreePath, args: ['add', '--', markerRelativePath] }), 'SMOKE_GIT_ADD_FAILED');
    assertGit(runGit({ cwd: taskWorktreePath, args: ['commit', '-m', 'test: add MoreAgent repository smoke marker'] }), 'SMOKE_GIT_COMMIT_FAILED');
    const taskHead = runGit({ cwd: taskWorktreePath, args: ['rev-parse', 'HEAD'] });
    assertGit(taskHead, 'SMOKE_TASK_COMMIT_FAILED');
    taskCommit = taskHead.stdout.trim();

    const changed = runGit({ cwd: taskWorktreePath, args: ['diff', '--name-only', `${baseCommit}..${taskCommit}`] });
    assertGit(changed, 'SMOKE_TASK_DIFF_FAILED');
    const changedFiles = splitLines(changed.stdout);
    if (changedFiles.length !== 1 || changedFiles[0] !== markerRelativePath) {
      throw smokeError('SMOKE_SCOPE_VIOLATION', `Validation smoke modified unexpected paths: ${changedFiles.join(', ')}`);
    }

    const integrationService = createGitIntegrationService({ runGit, runCommand, now });
    integrationResult = await integrationService.integrate({
      projectId,
      workflowId,
      projectRoot: root,
      baseCommit,
      taskCommits: [taskCommit],
      integrationBranch,
      integrationWorktreePath,
      verificationCommands: [
        {
          verificationId: 'validation-diff-check',
          command: 'git',
          args: ['diff', '--check', `${baseCommit}..HEAD`],
          environment: 'stage7-validation',
          logPath: `logs/validation/${projectId}-diff-check.log`,
        },
        {
          verificationId: 'validation-scope-check',
          command: process.execPath,
          args: ['-e', `const {execFileSync}=require('node:child_process');const files=execFileSync('git',['diff','--name-only','${baseCommit}..HEAD'],{encoding:'utf8'}).trim().split(/\\r?\\n/).filter(Boolean);if(files.some(f=>!f.startsWith('${normalize(allowedValidationPath)}/')))process.exit(1);`],
          environment: 'stage7-validation',
          logPath: `logs/validation/${projectId}-scope-check.log`,
        },
      ],
      requirementIds: ['STAGE7-REAL-REPOSITORY-SMOKE'],
      cleanupWorktree: true,
    });
    if (!integrationResult.passed) throw smokeError('SMOKE_INTEGRATION_FAILED', integrationResult.failureReason || 'Integration smoke failed.');

    const finalStatus = runGit({ cwd: root, args: ['status', '--porcelain'] });
    assertGit(finalStatus, 'SMOKE_FINAL_STATUS_FAILED');
    if (finalStatus.stdout.trim()) throw smokeError('SMOKE_BASE_REPOSITORY_CHANGED', 'Base repository changed during validation smoke.');

    const report = {
      schemaVersion: '1.0',
      reportType: 'REAL_REPOSITORY_INTEGRATION_SMOKE',
      projectId,
      workflowId,
      status: 'PASSED',
      baseCommit,
      prdPath,
      prdHash,
      taskBranch,
      taskCommit,
      integrationBranch,
      integrationCommit: integrationResult.evidence.integrationCommit,
      changedFiles: integrationResult.evidence.changedFiles,
      verificationResults: integrationResult.evidence.verificationResults,
      businessCodeModified: false,
      remotePushPerformed: false,
      startedAt,
      finishedAt: timestamp(now),
    };
    if (outputPath) {
      const target = path.resolve(outputPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    return Object.freeze(report);
  } finally {
    const removeTask = runGit({ cwd: root, args: ['worktree', 'remove', '--force', taskWorktreePath] });
    cleanup.push({ action: 'remove-task-worktree', exitCode: removeTask.exitCode, stderr: removeTask.stderr });
    const removeIntegration = runGit({ cwd: root, args: ['worktree', 'remove', '--force', integrationWorktreePath] });
    cleanup.push({ action: 'remove-integration-worktree', exitCode: removeIntegration.exitCode, stderr: removeIntegration.stderr });
    runGit({ cwd: root, args: ['worktree', 'prune', '--expire', 'now'] });
    if (taskBranch) runGit({ cwd: root, args: ['branch', '-D', taskBranch] });
    if (integrationBranch) runGit({ cwd: root, args: ['branch', '-D', integrationBranch] });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function defaultRunGit({ cwd, args }) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 20 * 1024 * 1024 });
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function defaultRunCommand({ command, args = [], cwd, env = {} }) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: false, maxBuffer: 20 * 1024 * 1024 });
  return Promise.resolve({
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  });
}

function assertGit(result, code) {
  if (result.exitCode !== 0) throw smokeError(code, result.stderr || result.stdout || code);
}

function resolveInside(root, relativePath) {
  if (path.isAbsolute(relativePath)) throw smokeError('SMOKE_ABSOLUTE_PATH_DENIED', `Absolute path is not allowed: ${relativePath}`);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw smokeError('SMOKE_PATH_ESCAPE_DENIED', `Path escapes repository: ${relativePath}`);
  return target;
}

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sanitize(value) {
  return String(value || 'project').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function smokeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
