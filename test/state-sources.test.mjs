import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectStateSources } from '../src/core/state-sources.mjs';
import { reconcileStateSources } from '../src/core/reconcile.mjs';

const adapter = {
  project: { id: 'fixture' },
  paths: { workflowJson: 'state.json', workflowMarkdown: 'state.md', roundContext: 'round.json', currentRun: 'run.json', currentTasks: 'tasks.json', currentEvents: 'events.jsonl', agentWorktrees: '.agent-worktrees' },
  fields: { status: 'workflowStatus', step: 'step', phase: 'phase', round: 'round', gate: 'gate', gateStatus: 'gateStatus', activeAgent: 'activeAgent', ownerAgent: 'ownerAgent', failureReason: 'failureReason' },
  roundContextFields: { status: 'status', step: 'step', phase: 'phase', round: 'workflow_round', gate: 'gate', gateStatus: 'gate_status', activeAgent: 'active_agent', ownerAgent: 'owner_agent', failureReason: 'failure_reason' },
  criticalFields: ['status', 'step', 'phase', 'round', 'gate', 'gateStatus', 'activeAgent', 'ownerAgent', 'failureReason'],
  nullValues: ['null'],
  markdownPatterns: { status: '- status: ([^\\n]+)', step: '- step: ([^\\n]+)', phase: '- phase: ([^\\n]+)', round: '- round: (\\d+)', gate: '- gate: ([^\\n]+)', gateStatus: '- gateStatus: ([^\\n]+)', activeAgent: '- activeAgent: ([^\\n]+)', ownerAgent: '- ownerAgent: ([^\\n]+)', failureReason: '- failureReason: ([^\\n]+)' },
  runtime: { runIdField: 'runId', runStatusField: 'status', runPhaseField: 'phase', taskIdField: 'taskId', terminalRunStatuses: ['IDLE', 'FINISHED'], runReferenceFields: [], taskReferenceFields: [] },
  reconcile: {
    archiveRoot: '.runs/reconciled',
    idleRun: { phase: 'IDLE', gate: 'NONE', gateStatus: 'DRAFT', status: 'IDLE', step: 'IDLE' },
    blockedWorkflow: { status: 'BLOCKED_BY_SYSTEM', step: 'VERIFY', phase: 'INTAKE', round: 0, gate: 'NONE', gateStatus: 'DRAFT', activeAgent: 'verifier', ownerAgent: 'verifier', failureReason: 'state_source_split' },
    readyWorkflow: { status: 'READY', step: 'PLAN', phase: 'INTAKE', round: 0, gate: 'NONE', gateStatus: 'DRAFT', activeAgent: 'verifier', ownerAgent: 'verifier', failureReason: null }
  },
  m0: { message: 'M0 is independent.' }
};

function state() {
  return { workflowStatus: 'READY', step: 'PLAN', phase: 'INTAKE', round: 0, gate: 'NONE', gateStatus: 'DRAFT', activeAgent: 'verifier', ownerAgent: 'verifier', failureReason: null };
}

function markdown(value) {
  return `- status: ${value.workflowStatus}\n- step: ${value.step}\n- phase: ${value.phase}\n- round: ${value.round}\n- gate: ${value.gate}\n- gateStatus: ${value.gateStatus}\n- activeAgent: ${value.activeAgent}\n- ownerAgent: ${value.ownerAgent}\n- failureReason: ${value.failureReason}\n`;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-state-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  const value = state();
  await writeFile(path.join(root, 'state.json'), JSON.stringify(value));
  await writeFile(path.join(root, 'state.md'), markdown(value));
  await writeFile(path.join(root, 'round.json'), JSON.stringify({ status: value.workflowStatus, step: value.step, phase: value.phase, workflow_round: value.round, gate: value.gate, gate_status: value.gateStatus, active_agent: value.activeAgent, owner_agent: value.ownerAgent, failure_reason: value.failureReason }));
  await writeFile(path.join(root, 'run.json'), JSON.stringify({ runId: null, status: 'IDLE' }));
  await writeFile(path.join(root, 'tasks.json'), JSON.stringify({ tasks: [] }));
  await writeFile(path.join(root, 'events.jsonl'), '{"type":"run_idle"}\n');
  return root;
}

test('reports a reconciled project when all configured state sources agree', async () => {
  const root = await fixture();
  const result = await inspectStateSources({ projectRoot: root, adapter });
  assert.equal(result.splitDetected, false);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.workflow.status, 'READY');
});

test('reports a Markdown mismatch without depending on a product name', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'state.md'), markdown({ ...state(), workflowStatus: 'BLOCKED_BY_SYSTEM' }));
  const result = await inspectStateSources({ projectRoot: root, adapter });
  assert.equal(result.splitDetected, true);
  assert.ok(result.reasons.includes('workflow_markdown_mismatch'));
});

test('reconcile apply preserves pointers, writes evidence, and reaches READY only after all sources agree', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'state.md'), markdown({ ...state(), workflowStatus: 'BLOCKED_BY_SYSTEM' }));
  const dryRun = await reconcileStateSources({ projectRoot: root, adapter });
  assert.equal(dryRun.action, 'DRY_RUN');
  assert.equal(dryRun.exitCode, 2);
  const result = await reconcileStateSources({ projectRoot: root, adapter, apply: true, now: () => '2026-07-13T00:00:00.000Z' });
  assert.equal(result.action, 'RECONCILED');
  assert.equal(result.exitCode, 0);
  assert.equal(result.splitDetected, false);
  const evidence = JSON.parse(await readFile(path.join(root, '.runs/reconciled/2026-07-13T00-00-00-000Z/reconciliation.json'), 'utf8'));
  assert.equal(evidence.status, 'RECONCILED');
  const currentRun = JSON.parse(await readFile(path.join(root, 'run.json'), 'utf8'));
  const currentTasks = JSON.parse(await readFile(path.join(root, 'tasks.json'), 'utf8'));
  assert.equal(currentRun.runId, null);
  assert.deepEqual(currentTasks.tasks, []);
});
