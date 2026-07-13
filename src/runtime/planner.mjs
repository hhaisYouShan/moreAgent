import { evaluateCheckpoint } from '../contracts/checkpoint.mjs';

export async function createExecutionPlan({ projectRoot, adapter, workflow, mode = 'single' }) {
  const checkpoint = await evaluateCheckpoint({ projectRoot, adapter, workflow });
  if (checkpoint.required && !checkpoint.effectiveApproval) return blocked('checkpoint_required', checkpoint, mode);
  if (String(mode).toLowerCase() === 'auto' && adapter.delivery?.autoEnabled !== true) return blocked('auto_disabled', checkpoint, mode);
  const phase = String(workflow?.phase || '').toUpperCase();
  const templates = adapter.planner?.phases?.[phase] || [];
  return { allowed: true, mode, checkpoint, phase, tasks: templates.map((task, index) => ({ ...task, id: task.id || `${phase.toLowerCase()}-${index + 1}`, dependsOn: task.dependsOn || [] })), reason: null };
}

function blocked(reason, checkpoint, mode) { return { allowed: false, mode, checkpoint, phase: null, tasks: [], reason }; }
