import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExecutionPlan } from '../src/runtime/planner.mjs';
import { orchestrate } from '../src/runtime/orchestrator.mjs';

const adapter = { checkpoint: { requiredPhases: ['INTAKE'], resultPath: 'checkpoint.json', requiredFields: ['approved_by'] }, delivery: { autoEnabled: false }, planner: { phases: { INTAKE: [{ id: 'review', agent: 'product_agent' }], TESTING: [{ id: 'test', agent: 'test_agent' }] } } };

test('blocks a pre-product plan when the adapter checkpoint is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-plan-'));
  const plan = await createExecutionPlan({ projectRoot: root, adapter, workflow: { phase: 'INTAKE' } });
  assert.equal(plan.allowed, false);
  assert.equal(plan.reason, 'checkpoint_required');
  assert.deepEqual(plan.tasks, []);
});

test('blocks auto even after checkpoint approval when the adapter keeps it disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-plan-'));
  await writeFile(path.join(root, 'checkpoint.json'), JSON.stringify({ status: 'APPROVED', approved_by: 'user' }));
  const plan = await createExecutionPlan({ projectRoot: root, adapter, workflow: { phase: 'INTAKE' }, mode: 'auto' });
  assert.equal(plan.allowed, false);
  assert.equal(plan.reason, 'auto_disabled');
});

test('returns configured tasks only for an allowed single-mode phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-plan-'));
  const plan = await createExecutionPlan({ projectRoot: root, adapter, workflow: { phase: 'TESTING' } });
  assert.equal(plan.allowed, true);
  assert.deepEqual(plan.tasks.map((task) => task.id), ['test']);
});

test('orchestrates only an allowed plan through an injected executor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-plan-'));
  const result = await orchestrate({ projectRoot: root, adapter: { ...adapter, paths: { currentRun: '.runtime/run.json', currentTasks: '.runtime/tasks.json', currentEvents: '.runtime/events.jsonl' }, runtime: { runIdField: 'runId', taskIdField: 'taskId' } }, workflow: { phase: 'TESTING', gate: 'TEST_GATE', gateStatus: 'DRAFT', round: 0 }, runId: 'run-1', executeTask: async () => ({ status: 'DONE', exitCode: 0 }), now: () => '2026-07-13T00:00:00.000Z' });
  assert.equal(result.status, 'FINISHED');
  assert.equal(result.taskResults.length, 1);
});
