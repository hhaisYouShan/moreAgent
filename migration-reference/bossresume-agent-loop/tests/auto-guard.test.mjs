import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliScript = path.resolve(testDir, '../cli.mjs');
const orchestratorScript = path.resolve(testDir, '../orchestrator.mjs');

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createWorkflow(root, status, overrides = {}) {
  await writeJson(root, 'agent-loop-docs/process/workflow-state.json', {
    featureKey: 'demo',
    prdPath: 'docs/prd/demo.md',
    projectType: 'existing_refactor',
    productPrdEditMode: 'review_only',
    status,
    workflowStatus: status,
    step: status === 'BLOCKED_BY_SYSTEM' ? 'SYSTEM_FIX' : status === 'NEEDS_USER' ? 'DECIDE' : 'PLAN',
    phase: 'PRD_REVIEW',
    round: 1,
    failureCount: 0,
    retryCount: 0,
    failureReason: status === 'BLOCKED_BY_SYSTEM' ? 'worktree_input_missing' : status === 'NEEDS_USER' ? 'permission_model_undefined' : null,
    gate: 'PRD_GATE',
    gateStatus: status === 'BLOCKED_BY_SYSTEM' || status === 'NEEDS_USER' ? 'BLOCKED' : 'DRAFT',
    activeAgent: 'product_agent',
    nextAgent: 'product_agent',
    ownerAgent: 'product_agent',
    ownerAgents: 'product_agent',
    ...overrides,
  });
}

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

test('CLI rejects explicit auto before normal execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-cli-auto-'));
  await createWorkflow(root, 'READY');
  const result = run(cliScript, ['next', '--mode=auto'], { cwd: root });
  assert.equal(result.status, 1, outputOf(result));
  assert.match(outputOf(result), /AUTO mode unavailable/i);
  assert.equal(existsSync(path.join(root, '.agent-worktrees')), false);
});

test('CLI rejects preview auto before starting orchestrator dry-run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-cli-preview-auto-'));
  await createWorkflow(root, 'READY');
  const result = run(cliScript, ['next', '--preview', '--mode=auto'], { cwd: root });
  assert.equal(result.status, 1, outputOf(result));
  assert.match(outputOf(result), /AUTO mode unavailable/i);
  assert.doesNotMatch(outputOf(result), /\[agent-loop\] preflight/i);
  assert.equal(existsSync(path.join(root, '.agent-worktrees')), false);
});

test('direct orchestrator rejects --mode=auto before preflight', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-orchestrator-auto-'));
  const result = run(orchestratorScript, ['--mode=auto', '--dry-run'], { cwd: root });
  assert.equal(result.status, 1, outputOf(result));
  assert.match(outputOf(result), /AUTO mode unavailable/i);
  assert.doesNotMatch(outputOf(result), /\[agent-loop\] preflight/i);
  assert.equal(existsSync(path.join(root, '.agent-worktrees')), false);
});

test('direct orchestrator rejects AGENT_LOOP_MODE=auto before preflight', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-orchestrator-env-auto-'));
  const result = run(orchestratorScript, ['--dry-run'], { cwd: root, env: { AGENT_LOOP_MODE: 'auto' } });
  assert.equal(result.status, 1, outputOf(result));
  assert.match(outputOf(result), /AUTO mode unavailable/i);
  assert.doesNotMatch(outputOf(result), /\[agent-loop\] preflight/i);
  assert.equal(existsSync(path.join(root, '.agent-worktrees')), false);
});

test('direct orchestrator distinguishes system block from user decision block', async () => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-system-block-'));
  await createWorkflow(systemRoot, 'BLOCKED_BY_SYSTEM');
  const systemResult = run(orchestratorScript, ['--mode=single', '--dry-run'], { cwd: systemRoot });
  assert.equal(systemResult.status, 1, outputOf(systemResult));
  assert.match(outputOf(systemResult), /系统阻塞/);
  assert.match(outputOf(systemResult), /verify-current/);
  assert.doesNotMatch(outputOf(systemResult), /请运行 npm run agent -- chat/);
  assert.equal(existsSync(path.join(systemRoot, '.agent-worktrees')), false);

  const userRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-user-block-'));
  await createWorkflow(userRoot, 'NEEDS_USER');
  const userResult = run(orchestratorScript, ['--mode=single', '--dry-run'], { cwd: userRoot });
  assert.equal(userResult.status, 1, outputOf(userResult));
  assert.match(outputOf(userResult), /需要用户决策/);
  assert.match(outputOf(userResult), /chat/);
  assert.doesNotMatch(outputOf(userResult), /系统阻塞/);
  assert.equal(existsSync(path.join(userRoot, '.agent-worktrees')), false);
});

test('force-blocked-summary cannot bypass system block', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-system-force-block-'));
  await createWorkflow(root, 'BLOCKED_BY_SYSTEM');
  const result = run(orchestratorScript, ['--mode=single', '--dry-run', '--force-blocked-summary'], { cwd: root });
  assert.equal(result.status, 1, outputOf(result));
  assert.match(outputOf(result), /系统阻塞/);
  assert.match(outputOf(result), /verify-current/);
  assert.doesNotMatch(outputOf(result), /请运行 npm run agent -- chat/);
  assert.equal(existsSync(path.join(root, '.agent-worktrees')), false);
});
