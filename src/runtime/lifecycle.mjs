import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function startRun({ projectRoot, adapter, runId, workflow, tasks = [], mode = null, maxLoops = null, now = () => new Date().toISOString() }) {
  if (!runId) throw new Error('runId is required');
  const timestamp = now();
  const runtime = adapter.runtime;
  const run = {
    [runtime.runIdField]: runId,
    featureKey: workflow.featureKey ?? null,
    prdPath: workflow.prdPath ?? null,
    [runtime.runPhaseField]: workflow.phase,
    gate: workflow.gate,
    gateStatus: workflow.gateStatus,
    workflowRound: Number(workflow.round || 0) + 1,
    status: 'RUNNING', step: 'PLANNING', mode, maxLoops,
    startedAt: timestamp, updatedAt: timestamp, finishedAt: null,
  };
  const currentTasks = tasks.map((task) => ({ taskId: task.id, agent: task.agent, phase: task.phase || workflow.phase, round: task.round || run.workflowRound, status: 'PLANNED', step: 'PLANNED', outputs: task.outputs || task.outputFiles || [], gateResult: task.gateResult || task.gateResultFile || null, startedAt: null, completedAt: null, exitCode: null, failureReason: null }));
  await writeJson(projectRoot, adapter.paths.currentRun, run);
  await writeJson(projectRoot, adapter.paths.currentTasks, { runId, updatedAt: timestamp, tasks: currentTasks });
  await writeText(projectRoot, adapter.paths.currentEvents, '');
  await appendEvent({ projectRoot, adapter, type: 'run_started', status: 'RUNNING', step: 'PLANNING', message: 'Run started.', data: { runId, taskCount: currentTasks.length }, now });
  return { run, tasks: currentTasks };
}

export async function updateTask({ projectRoot, adapter, taskId, patch, now = () => new Date().toISOString() }) {
  const state = await readJson(projectRoot, adapter.paths.currentTasks) || { tasks: [] };
  const task = state.tasks.find((item) => String(item?.[adapter.runtime.taskIdField] || item?.taskId) === String(taskId));
  if (!task) throw new Error(`Task not found: ${taskId}`);
  Object.assign(task, patch, { updatedAt: now() });
  state.updatedAt = now();
  await writeJson(projectRoot, adapter.paths.currentTasks, state);
  await appendEvent({ projectRoot, adapter, type: 'task_updated', status: task.status || null, step: task.step || null, task: { id: taskId, agent: task.agent || null }, message: 'Task state updated.', data: patch, now });
  return task;
}

export async function finishRun({ projectRoot, adapter, status = 'FINISHED', message = 'Run finished.', now = () => new Date().toISOString() }) {
  const run = await readJson(projectRoot, adapter.paths.currentRun) || {};
  run.status = status; run.step = 'FINISHED'; run.finishedAt = now(); run.updatedAt = now(); run.message = message;
  await writeJson(projectRoot, adapter.paths.currentRun, run);
  await appendEvent({ projectRoot, adapter, type: 'run_finished', status, step: 'FINISHED', message, now });
  return run;
}

export async function appendEvent({ projectRoot, adapter, type, status = null, step = null, task = null, message = '', data = {}, now = () => new Date().toISOString() }) {
  const target = path.join(projectRoot, adapter.paths.currentEvents);
  await mkdir(path.dirname(target), { recursive: true });
  const event = { time: now(), type, status, step, task, message, data };
  await appendFile(target, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

async function readJson(root, relativePath) { try { return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')); } catch { return null; } }
async function writeJson(root, relativePath, value) { const target = path.join(root, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function writeText(root, relativePath, value) { const target = path.join(root, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, value, 'utf8'); }
