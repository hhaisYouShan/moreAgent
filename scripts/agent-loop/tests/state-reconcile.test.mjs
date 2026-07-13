import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDir, '../reconcile-state-sources.mjs');

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'state-reconcile-'));
  execFileSync('git', ['init', '-b', 'master'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await mkdir(path.join(root, 'agent-loop-docs/process'), { recursive: true });
  await writeJson(root, 'agent-loop-docs/process/workflow-state.json', {
    featureKey: 'bossresume-full-refactor',
    prdPath: 'docs/prd/bossresume-full-refactor-prd.md',
    projectType: 'existing_refactor',
    productPrdEditMode: 'review_only',
    status: 'READY',
    workflowStatus: 'READY',
    step: 'PLAN',
    phase: 'INTAKE',
    round: 0,
    failureCount: 0,
    gate: 'NONE',
    gateStatus: 'DRAFT',
    nextAgent: 'product_agent',
    ownerAgents: 'product_agent',
  });
  await writeFile(path.join(root, 'agent-loop-docs/process/workflow-state.md'), '# state\n');
  await writeJson(root, '.agent-runs/current-run.json', {
    runId: 'run-product-1',
    status: 'FINISHED',
    phase: 'PRODUCT_REVIEW',
    workflowRound: 1,
    gate: 'PRD_GATE',
    gateStatus: 'BLOCKED',
    workflowStatus: 'NEEDS_USER',
    decisionPath: 'agent-loop-docs/decisions/missing.md',
    issuesPath: 'agent-loop-docs/issues/missing.json',
    runDir: '.agent-runs/run-product-1',
  });
  await writeJson(root, '.agent-runs/current-tasks.json', {
    runId: 'run-product-1',
    tasks: [{ taskId: 'product-review', status: 'DONE', outputs: ['agent-loop-docs/reviews/missing.md'] }],
  });
  await writeFile(path.join(root, '.agent-runs/current-events.jsonl'), '{"type":"run_finished"}\n');
  await writeFile(path.join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' });
  return root;
}

function run(root, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('dry-run detects split and makes no changes', async () => {
  const root = await setupRepo();
  const before = await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8');
  const result = run(root);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /state_source_split|splitDetected/);
  const after = await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8');
  assert.equal(after, before);
});

test('apply archives stale pointers, reconciles every state source, and returns to READY', async () => {
  const root = await setupRepo();
  const result = run(root, ['--apply']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const workflow = JSON.parse(await readFile(path.join(root, 'agent-loop-docs/process/workflow-state.json'), 'utf8'));
  assert.equal(workflow.workflowStatus, 'READY');
  assert.equal(workflow.phase, 'INTAKE');
  assert.equal(workflow.round, 0);
  assert.equal(workflow.failureReason, null);

  const currentRun = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.equal(currentRun.runId, null);
  assert.equal(currentRun.status, 'IDLE');

  const reconciledRoot = path.join(root, '.agent-runs/reconciled');
  assert.equal(existsSync(reconciledRoot), true);
  const folders = await (await import('node:fs/promises')).readdir(reconciledRoot);
  const evidence = JSON.parse(await readFile(path.join(reconciledRoot, folders[0], 'reconciliation.json'), 'utf8'));
  assert.equal(evidence.status, 'RECONCILED');
  assert.equal(evidence.effective_m0_approval, false);
});

test('apply can remove clean orphan agent worktree and prune stale metadata', async () => {
  const root = await setupRepo();
  execFileSync('git', ['branch', 'orphan-worktree'], { cwd: root });
  await mkdir(path.join(root, '.agent-worktrees'), { recursive: true });
  execFileSync('git', ['worktree', 'add', path.join(root, '.agent-worktrees/orphan-worktree'), 'orphan-worktree'], {
    cwd: root,
    stdio: 'ignore',
  });

  const result = run(root, ['--apply', '--remove-orphan-worktrees', '--prune-worktrees']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(path.join(root, '.agent-worktrees/orphan-worktree')), false);
});

test('dry-run detects Markdown and Round Context drift after runtime pointers are clean', async () => {
  const root = await setupRepo();
  const firstApply = run(root, ['--apply']);
  assert.equal(firstApply.status, 0, `${firstApply.stdout}\n${firstApply.stderr}`);

  await writeFile(path.join(root, 'agent-loop-docs/process/workflow-state.md'), '# stale presentation\n');
  await writeJson(root, 'agent-loop-docs/process/round-context.json', {
    status: 'BLOCKED_BY_SYSTEM',
    step: 'VERIFY',
    phase: 'INTAKE',
    workflow_round: 0,
    gate: 'NONE',
    gate_status: 'DRAFT',
    active_agent: 'gate_verifier',
    owner_agent: 'gate_verifier',
    failure_reason: 'state_source_split',
  });

  const result = run(root);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /workflow_markdown_mismatch/);
  assert.match(result.stdout, /round_context_mismatch/);
});

test('apply remains blocked when an orphan worktree is not authorized for removal', async () => {
  const root = await setupRepo();
  execFileSync('git', ['branch', 'orphan-worktree'], { cwd: root });
  await mkdir(path.join(root, '.agent-worktrees'), { recursive: true });
  execFileSync('git', ['worktree', 'add', path.join(root, '.agent-worktrees/orphan-worktree'), 'orphan-worktree'], {
    cwd: root,
    stdio: 'ignore',
  });

  const result = run(root, ['--apply']);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  const workflow = JSON.parse(await readFile(path.join(root, 'agent-loop-docs/process/workflow-state.json'), 'utf8'));
  assert.equal(workflow.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(workflow.failureReason, 'state_source_split');
});
