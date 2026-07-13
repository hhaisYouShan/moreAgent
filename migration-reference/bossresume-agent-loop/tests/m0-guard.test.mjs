import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateM0Checkpoint } from '../m0-guard.mjs';

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createGitRepo(root) {
  execFileSync('git', ['init', '-b', 'master'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'master'], { cwd: root, encoding: 'utf8' }).trim();
}

function workflow(featureKey = 'bossresume-full-refactor') {
  return { featureKey, workflowStatus: 'READY', status: 'READY', phase: 'INTAKE', round: 0, gate: 'NONE', gateStatus: 'DRAFT' };
}

function approvedResult({ baseSha, featureKey = 'bossresume-full-refactor', evidencePath = 'evidence/m0.json' }) {
  return {
    schema_version: '1.0',
    checkpoint_type: 'M0_BASELINE',
    project_id: 'bossresume',
    feature_key: featureKey,
    status: 'APPROVED',
    base_branch: 'master',
    base_sha: baseSha,
    checked_at: '2026-07-13T16:00:00+08:00',
    checked_by: ['gate_verifier'],
    approved_by: 'user/project-owner',
    approved_at: '2026-07-13T16:05:00+08:00',
    workflow_snapshot: { workflow_status: 'READY', phase: 'INTAKE', round: 0, gate: 'NONE', gate_status: 'DRAFT', current_run_id: null, active_task_ids: [] },
    mode: { single: true, auto: false },
    state_source_reconciliation: { status: 'RECONCILED', evidence_path: 'evidence/reconciliation.json', checked_at: '2026-07-13T15:59:00+08:00' },
    scope_guard: { business_prd_modified: false, business_code_modified: false, brain_has_business_code_write_permission: false },
    evidence_manifest_path: evidencePath,
    verification_results: [{ verification_id: 'doctor', required: true, command: 'npm run agent -- doctor', cwd: '.', exit_code: 0, environment: 'test', commit_sha: baseSha, log_path: 'logs/doctor.log', executed_at: '2026-07-13T16:01:00+08:00', result: 'PASS' }],
    issues: [],
    open_blocking_count: 0,
    open_major_count: 0,
    notes: '',
  };
}

async function writeValidRuntime(root, baseSha) {
  await writeJson(root, 'evidence/m0.json', { base_sha: baseSha });
  await writeJson(root, 'evidence/reconciliation.json', { status: 'RECONCILED' });
  await writeJson(root, '.agent-runs/current-run.json', { runId: null, status: 'IDLE' });
  await writeJson(root, '.agent-runs/current-tasks.json', { runId: null, tasks: [] });
}

test('missing M0 result blocks pre-product phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-missing-'));
  await createGitRepo(root);
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: workflow() });
  assert.equal(result.required, true);
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['checkpoint_result_missing']);
});

test('valid M0 result allows pre-product phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-approved-'));
  const baseSha = await createGitRepo(root);
  await writeValidRuntime(root, baseSha);
  await writeJson(root, 'agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json', approvedResult({ baseSha }));
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: workflow() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.effectiveApproval, true);
});

test('stale base SHA and open Major invalidate APPROVED string', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-stale-'));
  const baseSha = await createGitRepo(root);
  await writeValidRuntime(root, baseSha);
  const value = approvedResult({ baseSha: '0'.repeat(40) });
  value.issues = [{ issue_id: 'M001', severity: 'MAJOR', status: 'OPEN' }];
  value.open_major_count = 1;
  await writeJson(root, 'agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json', value);
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: workflow() });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('base_sha_mismatch'));
  assert.ok(result.reasons.includes('open_major_count_nonzero'));
  assert.ok(result.reasons.includes('open_blocking_or_major_issue'));
});

test('APPROVED string is rejected while state sources are not reconciled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-reconcile-'));
  const baseSha = await createGitRepo(root);
  await writeJson(root, 'evidence/m0.json', { base_sha: baseSha });
  const value = approvedResult({ baseSha });
  value.state_source_reconciliation = { status: 'SPLIT', evidence_path: '', checked_at: '' };
  await writeJson(root, 'agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json', value);
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: workflow() });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('state_sources_not_reconciled'));
  assert.ok(result.reasons.includes('reconciliation_evidence_missing'));
});

test('BLOCKED_BY_SYSTEM runtime cannot be approved by a stale READY snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-runtime-'));
  const baseSha = await createGitRepo(root);
  await writeJson(root, 'evidence/m0.json', { base_sha: baseSha });
  await writeJson(root, 'evidence/reconciliation.json', { status: 'RECONCILED' });
  await writeJson(root, '.agent-runs/current-run.json', { runId: 'old-product-run', status: 'FINISHED' });
  await writeJson(root, '.agent-runs/current-tasks.json', { runId: 'old-product-run', tasks: [{ taskId: 'product-review' }] });
  await writeJson(root, 'agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json', approvedResult({ baseSha }));
  const blocked = { ...workflow(), workflowStatus: 'BLOCKED_BY_SYSTEM', status: 'BLOCKED_BY_SYSTEM' };
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: blocked });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('current_workflow_status_not_ready'));
  assert.ok(result.reasons.includes('workflow_snapshot_status_mismatch'));
  assert.ok(result.reasons.includes('current_runtime_run_present'));
  assert.ok(result.reasons.includes('current_runtime_tasks_present'));
});

test('post-product phase does not re-run M0 start guard', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm0-guard-later-'));
  await createGitRepo(root);
  const state = { ...workflow(), phase: 'PRD_REVIEW', round: 1 };
  const result = evaluateM0Checkpoint({ repoRoot: root, workflowState: state });
  assert.equal(result.required, false);
  assert.equal(result.ok, true);
});
