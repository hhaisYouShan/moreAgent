import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectProject } from '../src/validation/project-inspector.mjs';
import { runRepositorySmoke } from '../src/validation/repository-smoke.mjs';

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-real-project-'));
  await mkdir(path.join(root, 'client/src'), { recursive: true });
  await mkdir(path.join(root, 'server/src'), { recursive: true });
  await mkdir(path.join(root, 'docs/prd'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'real-project-fixture', scripts: { test: 'node --test' } }, null, 2));
  await writeFile(path.join(root, 'client/package.json'), JSON.stringify({ name: 'client-fixture', scripts: { build: 'node -e "process.exit(0)"' } }, null, 2));
  await writeFile(path.join(root, 'server/package.json'), JSON.stringify({ name: 'server-fixture', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  await writeFile(path.join(root, 'client/src/index.js'), 'export const client = true;\n');
  await writeFile(path.join(root, 'server/src/index.js'), 'export const server = true;\n');
  await writeFile(path.join(root, 'docs/prd/bossresume-full-refactor-prd.md'), '# Fixture PRD\n\nREQ-FIXTURE-001\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial fixture']);
  return root;
}

function profile() {
  return {
    projectId: 'fixture-project',
    repository: { provider: 'LOCAL', fullName: 'fixture/project', ref: 'HEAD' },
    requiredPaths: [
      { path: 'package.json', type: 'file', required: true },
      { path: 'client', type: 'directory', required: true },
      { path: 'server', type: 'directory', required: true },
      { path: 'docs/prd/bossresume-full-refactor-prd.md', type: 'file', required: true },
    ],
    manifests: [
      { path: 'package.json', required: true },
      { path: 'client/package.json', required: true },
      { path: 'server/package.json', required: true },
    ],
    moduleRoots: ['client', 'server', 'docs/prd'],
    verificationCommands: [
      { verificationId: 'git-clean', command: 'git', args: ['status', '--porcelain'], cwd: '.', required: true },
      { verificationId: 'client-build', manifestPath: 'client/package.json', whenScript: 'build', command: 'npm', args: ['run', 'build'], cwd: 'client', required: false },
    ],
  };
}

test('generic project inspector records baseline, manifests, languages and command evidence', async () => {
  const root = await createRepository();
  try {
    const report = await inspectProject({ projectRoot: root, profile: profile(), mode: 'verify' });
    assert.equal(report.status, 'PASSED');
    assert.match(report.git.commit, /^[a-f0-9]{40}$/);
    assert.equal(report.git.clean, true);
    assert.equal(report.requiredPaths.every((item) => item.exists && item.typeMatches), true);
    assert.equal(report.manifests.every((item) => item.exists && !item.parseError), true);
    assert.ok(report.projectMap.metadata.fileCount >= 6);
    assert.ok(report.projectMap.metadata.languages.some((item) => item.language === 'JavaScript'));
    assert.equal(report.verificationResults.find((item) => item.verificationId === 'git-clean').result, 'PASS');
    assert.equal(report.verificationResults.find((item) => item.verificationId === 'client-build').result, 'PASS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project inspector fails required path checks without guessing missing project facts', async () => {
  const root = await createRepository();
  try {
    const invalidProfile = profile();
    invalidProfile.requiredPaths.push({ path: 'missing/required.file', type: 'file', required: true });
    const report = await inspectProject({ projectRoot: root, profile: invalidProfile, mode: 'inspect' });
    assert.equal(report.status, 'FAILED');
    assert.ok(report.failureReasons.includes('missing_required_path:missing/required.file'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real repository smoke creates Task and Integration commits without changing the base checkout', async () => {
  const root = await createRepository();
  try {
    const before = git(root, ['rev-parse', 'HEAD']).stdout.trim();
    const report = await runRepositorySmoke({
      projectRoot: root,
      projectId: 'fixture-project',
      workflowId: 'workflow-fixture-validation',
      prdPath: 'docs/prd/bossresume-full-refactor-prd.md',
    });

    assert.equal(report.status, 'PASSED');
    assert.equal(report.baseCommit, before);
    assert.match(report.taskCommit, /^[a-f0-9]{40}$/);
    assert.match(report.integrationCommit, /^[a-f0-9]{40}$/);
    assert.notEqual(report.taskCommit, report.integrationCommit);
    assert.deepEqual(report.changedFiles, ['.moreagent-validation/stage7-smoke.json']);
    assert.equal(report.businessCodeModified, false);
    assert.equal(report.remotePushPerformed, false);
    assert.equal(git(root, ['rev-parse', 'HEAD']).stdout.trim(), before);
    assert.equal(git(root, ['status', '--porcelain']).stdout.trim(), '');
    assert.equal(git(root, ['branch', '--list', 'validation/*']).stdout.trim(), '');
    await assert.rejects(() => readFile(path.join(root, '.moreagent-validation/stage7-smoke.json'), 'utf8'), (error) => error.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real repository smoke refuses a dirty base checkout', async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, 'uncommitted.txt'), 'dirty\n');
    await assert.rejects(
      () => runRepositorySmoke({
        projectRoot: root,
        projectId: 'fixture-project',
        workflowId: 'workflow-fixture-validation',
        prdPath: 'docs/prd/bossresume-full-refactor-prd.md',
      }),
      (error) => error.code === 'SMOKE_REPOSITORY_DIRTY',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}
