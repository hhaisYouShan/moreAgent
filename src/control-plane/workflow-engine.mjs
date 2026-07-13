import { WorkflowPhase, WorkflowStatus, assertEnumValue } from '../domain/enums.mjs';

const PHASE_TRANSITIONS = Object.freeze({
  INTAKE: ['PRODUCT_DESIGN'],
  PRODUCT_DESIGN: ['MULTI_ROLE_REVIEW'],
  MULTI_ROLE_REVIEW: ['PRODUCT_DESIGN', 'TECHNICAL_DESIGN'],
  TECHNICAL_DESIGN: ['MULTI_ROLE_REVIEW', 'TASK_PLANNING'],
  TASK_PLANNING: ['TECHNICAL_DESIGN', 'IMPLEMENTATION'],
  IMPLEMENTATION: ['REVIEW'],
  REVIEW: ['IMPLEMENTATION', 'INTEGRATION'],
  INTEGRATION: ['IMPLEMENTATION', 'SYSTEM_TEST'],
  SYSTEM_TEST: ['IMPLEMENTATION', 'PRODUCT_ACCEPTANCE'],
  PRODUCT_ACCEPTANCE: ['IMPLEMENTATION', 'USER_ACCEPTANCE'],
  USER_ACCEPTANCE: ['PRODUCT_DESIGN', 'TECHNICAL_DESIGN', 'IMPLEMENTATION', 'RELEASE'],
  RELEASE: ['MAINTENANCE'],
  MAINTENANCE: ['PRODUCT_DESIGN', 'IMPLEMENTATION', 'ARCHIVED'],
  ARCHIVED: [],
});

const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['WAITING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['READY', 'RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  FAILED: ['READY', 'CANCELLED', 'ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
});

export function canTransitionPhase(fromPhase, toPhase) {
  assertEnumValue(WorkflowPhase, fromPhase, 'fromPhase');
  assertEnumValue(WorkflowPhase, toPhase, 'toPhase');
  return PHASE_TRANSITIONS[fromPhase].includes(toPhase);
}

export function canTransitionStatus(fromStatus, toStatus) {
  assertEnumValue(WorkflowStatus, fromStatus, 'fromStatus');
  assertEnumValue(WorkflowStatus, toStatus, 'toStatus');
  return STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export function transitionWorkflow({ workflow, toPhase = workflow?.phase, toStatus = workflow?.status, actor, reason, at = new Date().toISOString() }) {
  if (!workflow || typeof workflow !== 'object') throw new TypeError('workflow is required');
  if (!actor) throw new TypeError('actor is required');
  if (!reason) throw new TypeError('reason is required');

  assertEnumValue(WorkflowPhase, workflow.phase, 'workflow.phase');
  assertEnumValue(WorkflowStatus, workflow.status, 'workflow.status');
  assertEnumValue(WorkflowPhase, toPhase, 'toPhase');
  assertEnumValue(WorkflowStatus, toStatus, 'toStatus');

  const phaseChanged = toPhase !== workflow.phase;
  const statusChanged = toStatus !== workflow.status;
  if (!phaseChanged && !statusChanged) throw transitionError('NO_STATE_CHANGE', 'Workflow transition must change phase or status.');
  if (phaseChanged && !canTransitionPhase(workflow.phase, toPhase)) {
    throw transitionError('INVALID_PHASE_TRANSITION', `Cannot transition phase ${workflow.phase} -> ${toPhase}.`);
  }
  if (statusChanged && !canTransitionStatus(workflow.status, toStatus)) {
    throw transitionError('INVALID_STATUS_TRANSITION', `Cannot transition status ${workflow.status} -> ${toStatus}.`);
  }
  if (phaseChanged && !['RUNNING', 'READY', 'WAITING'].includes(toStatus)) {
    throw transitionError('INVALID_PHASE_STATUS', 'A phase change requires READY, RUNNING, or WAITING status.');
  }
  if (toPhase === WorkflowPhase.ARCHIVED && toStatus !== WorkflowStatus.ARCHIVED) {
    throw transitionError('ARCHIVE_STATUS_REQUIRED', 'ARCHIVED phase requires ARCHIVED status.');
  }

  const next = Object.freeze({
    ...workflow,
    phase: toPhase,
    status: toStatus,
    updatedAt: at,
    version: Number(workflow.version || 0) + 1,
  });

  const event = Object.freeze({
    schemaVersion: '1.0',
    entityType: 'EVENT',
    eventId: `event-${workflow.workflowId}-${next.version}`,
    eventType: 'workflow.transitioned',
    eventVersion: '1.0',
    traceId: workflow.traceId || workflow.workflowId,
    projectId: workflow.projectId,
    workflowId: workflow.workflowId,
    taskId: null,
    runId: null,
    sessionId: null,
    actor,
    occurredAt: at,
    idempotencyKey: `${workflow.workflowId}:transition:${next.version}`,
    payload: {
      fromPhase: workflow.phase,
      toPhase,
      fromStatus: workflow.status,
      toStatus,
      reason,
      previousVersion: Number(workflow.version || 0),
      nextVersion: next.version,
    },
  });

  return { workflow: next, event };
}

export function phaseTransitions() {
  return PHASE_TRANSITIONS;
}

export function statusTransitions() {
  return STATUS_TRANSITIONS;
}

function transitionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
