import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finishRun, startRun, updateTask } from '../src/runtime/lifecycle.mjs';
import { listWorktrees } from '../src/runtime/worktrees.mjs';

const adapter = { paths: { currentRun: '.runtime/run.json', currentTasks: '.runtime/tasks.json', currentEvents: '.runtime/events.jsonl', agentWorktrees: '.runtime/worktrees' }, runtime: { runIdField: 'runId', taskIdField: 'taskId' } };
const clock = () => '2026-07-13T00:00:00.000Z';

test('records a run, task transition, and terminal event as project-local state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-runtime-'));
  await startRun({ projectRoot: root, adapter, runId: 'run-1', workflow: { phase: 'TESTING', gate: 'TEST_GATE', gateStatus: 'DRAFT', round: 2 }, tasks: [{ id: 'task-1', agent: 'test_agent' }], now: clock });
  const task = await updateTask({ projectRoot: root, adapter, taskId: 'task-1', patch: { status: 'DONE', step: 'FINISHED' }, now: clock });
  await finishRun({ projectRoot: root, adapter, now: clock });
  assert.equal(task.status, 'DONE');
  const run = JSON.parse(await readFile(path.join(root, '.runtime/run.json'), 'utf8'));
  assert.equal(run.status, 'FINISHED');
  const events = await readFile(path.join(root, '.runtime/events.jsonl'), 'utf8');
  assert.match(events, /run_started/);
  assert.match(events, /task_updated/);
  assert.match(events, /run_finished/);
});

test('does not classify the primary worktree as an orphan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-worktree-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  const result = listWorktrees({ projectRoot: root, adapter, activeTaskIds: [] });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.orphan, []);
});
