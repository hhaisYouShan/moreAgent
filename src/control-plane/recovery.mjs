import { RunStatus, TaskStatus, WorkflowPhase, WorkflowStatus } from '../domain/enums.mjs';

export function rebuildStateFromEvents({ workflow, tasks = [], events = [] }) {
  if (!workflow) throw new TypeError('workflow is required');
  const workflowState = { ...workflow };
  const taskMap = new Map(tasks.map((task) => [task.taskId, { ...task }]));
  const seenIdempotencyKeys = new Set();
  const appliedEventIds = [];
  const duplicateEventIds = [];

  const ordered = [...events].sort(compareEvents);
  for (const event of ordered) {
    const key = event?.idempotencyKey;
    if (!key) throw recoveryError('EVENT_IDEMPOTENCY_KEY_REQUIRED', `Event ${event?.eventId || 'UNKNOWN'} has no idempotencyKey.`);
    if (seenIdempotencyKeys.has(key)) {
      duplicateEventIds.push(event.eventId || key);
      continue;
    }
    seenIdempotencyKeys.add(key);

    switch (event.eventType) {
      case 'workflow.transitioned':
        applyWorkflowTransition(workflowState, event);
        break;
      case 'task.status_changed':
        applyTaskStatus(taskMap, event);
        break;
      case 'task.created':
        applyTaskCreated(taskMap, event);
        break;
      default:
        break;
    }
    appliedEventIds.push(event.eventId || key);
  }

  return Object.freeze({
    workflow: Object.freeze(workflowState),
    tasks: Object.freeze([...taskMap.values()].map((task) => Object.freeze(task))),
    appliedEventIds: Object.freeze(appliedEventIds),
    duplicateEventIds: Object.freeze(duplicateEventIds),
  });
}

export function planRecovery({ runs = [], sessions = [], locks = [], now = Date.now(), heartbeatTimeoutMs = 60_000 } = {}) {
  const current = toMillis(now);
  if (!Number.isInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs < 1) throw new TypeError('heartbeatTimeoutMs must be a positive integer');

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const staleSessionIds = new Set();
  for (const session of sessions) {
    if (session.status === 'CLOSED') continue;
    const heartbeat = toMillis(session.lastHeartbeatAt);
    if (current - heartbeat > heartbeatTimeoutMs) staleSessionIds.add(session.sessionId);
  }

  const expiredLocks = locks.filter((lock) => Number(lock.leaseUntil) <= current);
  const staleRuns = [];
  const resumableRuns = [];
  const failedRuns = [];

  for (const run of runs) {
    if (![RunStatus.QUEUED, RunStatus.RUNNING].includes(run.status)) continue;
    const session = run.sessionId ? sessionMap.get(run.sessionId) : null;
    if (!session || staleSessionIds.has(run.sessionId)) {
      staleRuns.push(run.runId);
      if (run.sideEffectsCommitted) failedRuns.push(run.runId);
      else resumableRuns.push(run.runId);
    }
  }

  const actions = [];
  for (const lock of expiredLocks) actions.push(action('RELEASE_EXPIRED_LOCK', lock.resource, lock.ownerId));
  for (const sessionId of [...staleSessionIds].sort()) actions.push(action('MARK_SESSION_STALE', sessionId));
  for (const runId of [...resumableRuns].sort()) actions.push(action('RESUME_WITH_NEW_ATTEMPT', runId));
  for (const runId of [...failedRuns].sort()) actions.push(action('BLOCK_FOR_SIDE_EFFECT_RECONCILIATION', runId));

  return Object.freeze({
    safeToResume: failedRuns.length === 0,
    staleSessionIds: Object.freeze([...staleSessionIds].sort()),
    staleRunIds: Object.freeze(staleRuns.sort()),
    resumableRunIds: Object.freeze(resumableRuns.sort()),
    blockedRunIds: Object.freeze(failedRuns.sort()),
    expiredLocks: Object.freeze(expiredLocks.map((lock) => lock.resource).sort()),
    actions: Object.freeze(actions),
  });
}

export function evaluateConvergence({ attemptCount, maxAttempts, repeatedIssueCount = 0, maxRepeatedIssueCount = 3 }) {
  if (![attemptCount, maxAttempts, repeatedIssueCount, maxRepeatedIssueCount].every(Number.isInteger)) throw new TypeError('convergence values must be integers');
  if (attemptCount >= maxAttempts) return Object.freeze({ converged: false, reason: 'max_attempts_reached' });
  if (repeatedIssueCount >= maxRepeatedIssueCount) return Object.freeze({ converged: false, reason: 'non_convergent_issue' });
  return Object.freeze({ converged: true, reason: null });
}

function applyWorkflowTransition(workflow, event) {
  const payload = event.payload || {};
  if (payload.fromPhase && workflow.phase !== payload.fromPhase) {
    throw recoveryError('WORKFLOW_EVENT_BASE_MISMATCH', `Expected workflow phase ${payload.fromPhase}, found ${workflow.phase}.`);
  }
  if (payload.fromStatus && workflow.status !== payload.fromStatus) {
    throw recoveryError('WORKFLOW_EVENT_STATUS_MISMATCH', `Expected workflow status ${payload.fromStatus}, found ${workflow.status}.`);
  }
  if (!Object.values(WorkflowPhase).includes(payload.toPhase)) throw recoveryError('WORKFLOW_EVENT_PHASE_INVALID', `Invalid phase: ${payload.toPhase}.`);
  if (!Object.values(WorkflowStatus).includes(payload.toStatus)) throw recoveryError('WORKFLOW_EVENT_STATUS_INVALID', `Invalid status: ${payload.toStatus}.`);
  workflow.phase = payload.toPhase;
  workflow.status = payload.toStatus;
  workflow.version = payload.nextVersion ?? Number(workflow.version || 0) + 1;
  workflow.updatedAt = event.occurredAt;
}

function applyTaskStatus(taskMap, event) {
  const taskId = event.taskId || event.payload?.taskId;
  const task = taskMap.get(taskId);
  if (!task) throw recoveryError('TASK_EVENT_TARGET_MISSING', `Task not found: ${taskId}.`);
  const nextStatus = event.payload?.toStatus;
  if (!Object.values(TaskStatus).includes(nextStatus)) throw recoveryError('TASK_EVENT_STATUS_INVALID', `Invalid Task status: ${nextStatus}.`);
  if (event.payload?.fromStatus && task.status !== event.payload.fromStatus) {
    throw recoveryError('TASK_EVENT_BASE_MISMATCH', `Expected Task ${taskId} status ${event.payload.fromStatus}, found ${task.status}.`);
  }
  task.status = nextStatus;
  task.updatedAt = event.occurredAt;
  task.version = event.payload?.nextVersion ?? Number(task.version || 0) + 1;
}

function applyTaskCreated(taskMap, event) {
  const task = event.payload?.task;
  if (!task?.taskId) throw recoveryError('TASK_CREATED_PAYLOAD_INVALID', 'task.created requires payload.task.taskId.');
  if (taskMap.has(task.taskId)) throw recoveryError('TASK_ALREADY_EXISTS', `Task already exists: ${task.taskId}.`);
  taskMap.set(task.taskId, { ...task });
}

function compareEvents(left, right) {
  const time = toMillis(left.occurredAt) - toMillis(right.occurredAt);
  if (time !== 0) return time;
  return String(left.eventId || '').localeCompare(String(right.eventId || ''));
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`Invalid time value: ${value}`);
  return parsed;
}

function action(type, targetId, ownerId = null) {
  return Object.freeze({ type, targetId, ownerId });
}

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
