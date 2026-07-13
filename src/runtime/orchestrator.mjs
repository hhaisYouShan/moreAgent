import { createExecutionPlan } from './planner.mjs';
import { finishRun, startRun, updateTask } from './lifecycle.mjs';

export async function orchestrate({ projectRoot, adapter, workflow, runId, mode = 'single', executeTask, now }) {
  const plan = await createExecutionPlan({ projectRoot, adapter, workflow, mode });
  if (!plan.allowed) return { started: false, plan, taskResults: [] };
  if (typeof executeTask !== 'function') throw new Error('executeTask is required for an allowed execution plan');
  await startRun({ projectRoot, adapter, runId, workflow, tasks: plan.tasks, mode, now });
  const taskResults = [];
  for (const task of plan.tasks) {
    await updateTask({ projectRoot, adapter, taskId: task.id, patch: { status: 'RUNNING', step: 'EXECUTING', startedAt: now?.() || new Date().toISOString() }, now });
    try {
      const result = await executeTask(task);
      taskResults.push({ taskId: task.id, ...result });
      await updateTask({ projectRoot, adapter, taskId: task.id, patch: { status: result?.status || 'DONE', step: 'FINISHED', exitCode: result?.exitCode ?? 0, outputs: result?.outputs || task.outputs || [] }, now });
    } catch (error) {
      const message = error?.message || String(error);
      taskResults.push({ taskId: task.id, status: 'FAILED', error: message });
      await updateTask({ projectRoot, adapter, taskId: task.id, patch: { status: 'FAILED', step: 'FINISHED', exitCode: 1, failureReason: message }, now });
      await finishRun({ projectRoot, adapter, status: 'FAILED', message: `Task ${task.id} failed.`, now });
      return { started: true, plan, taskResults, status: 'FAILED' };
    }
  }
  await finishRun({ projectRoot, adapter, status: 'FINISHED', message: 'All planned tasks completed.', now });
  return { started: true, plan, taskResults, status: 'FINISHED' };
}
