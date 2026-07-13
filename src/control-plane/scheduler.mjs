import { TaskStatus } from '../domain/enums.mjs';
import { executionKey, validateTaskDag } from './dag.mjs';

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING']);
const TERMINAL_TASK_STATUSES = new Set(['APPROVED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);

export function scheduleTasks({
  tasks = [],
  externalArtifactIds = [],
  activeRuns = [],
  heldLocks = [],
  maxConcurrent = 1,
  mode = 'single',
  isContextValid = () => true,
  isBudgetAllowed = () => true,
  isPermissionAllowed = () => true,
} = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('maxConcurrent must be a positive integer');

  const dag = validateTaskDag({ tasks, externalArtifactIds });
  if (!dag.valid) {
    return Object.freeze({ allowed: false, reason: 'invalid_dag', dag, assignments: Object.freeze([]), decisions: Object.freeze([]) });
  }

  const taskMap = new Map(tasks.map((task) => [task.taskId, task]));
  const active = activeRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run?.status));
  const activeTaskIds = new Set(active.map((run) => run.taskId));
  const activeExecutionKeys = new Set(active.map((run) => run.executionKey).filter(Boolean));
  const lockOwners = new Map();
  for (const lock of heldLocks) {
    if (lock?.resource && lock?.ownerId) lockOwners.set(lock.resource, lock.ownerId);
  }

  const capacity = Math.max(0, maxConcurrent - active.length);
  const assignments = [];
  const decisions = [];

  for (const taskId of dag.topologicalOrder) {
    const task = taskMap.get(taskId);
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      decisions.push(decision(taskId, 'SKIP', 'terminal_task'));
      continue;
    }
    if (activeTaskIds.has(taskId)) {
      decisions.push(decision(taskId, 'SKIP', 'already_active'));
      continue;
    }

    const dependencyBlock = firstDependencyBlock(task, taskMap);
    if (dependencyBlock) {
      decisions.push(decision(taskId, 'BLOCKED', dependencyBlock));
      continue;
    }

    const activeConflict = firstActiveConflict(task, activeTaskIds, taskMap);
    if (activeConflict) {
      decisions.push(decision(taskId, 'BLOCKED', `active_conflict:${activeConflict}`));
      continue;
    }

    const lockedResource = firstUnavailableLock(task, lockOwners, taskId);
    if (lockedResource) {
      decisions.push(decision(taskId, 'BLOCKED', `resource_locked:${lockedResource}`));
      continue;
    }

    const key = executionKey(task, mode);
    if (activeExecutionKeys.has(key)) {
      decisions.push(decision(taskId, 'BLOCKED', 'duplicate_execution_key'));
      continue;
    }
    if (!isContextValid(task)) {
      decisions.push(decision(taskId, 'BLOCKED', 'context_invalid'));
      continue;
    }
    if (!isBudgetAllowed(task)) {
      decisions.push(decision(taskId, 'BLOCKED', 'budget_denied'));
      continue;
    }
    if (!isPermissionAllowed(task)) {
      decisions.push(decision(taskId, 'BLOCKED', 'permission_denied'));
      continue;
    }
    if (assignments.length >= capacity) {
      decisions.push(decision(taskId, 'WAITING', 'concurrency_capacity'));
      continue;
    }

    assignments.push(Object.freeze({
      taskId,
      ownerAgent: task.ownerAgent,
      executionKey: key,
      resourceLocks: Object.freeze([...(task.resourceLocks || [])]),
      status: TaskStatus.READY,
    }));
    decisions.push(decision(taskId, 'READY', 'all_guards_passed'));
  }

  return Object.freeze({
    allowed: true,
    reason: null,
    dag,
    capacity,
    assignments: Object.freeze(assignments),
    decisions: Object.freeze(decisions),
  });
}

function firstDependencyBlock(task, taskMap) {
  for (const dependencyId of task.dependsOn || []) {
    const dependency = taskMap.get(dependencyId);
    if (!dependency) return `missing_dependency:${dependencyId}`;
    if (dependency.status !== TaskStatus.APPROVED) return `dependency_not_approved:${dependencyId}`;
  }
  return null;
}

function firstActiveConflict(task, activeTaskIds, taskMap) {
  for (const conflictId of task.conflictsWith || []) {
    if (activeTaskIds.has(conflictId)) return conflictId;
  }
  for (const activeTaskId of activeTaskIds) {
    if ((taskMap.get(activeTaskId)?.conflictsWith || []).includes(task.taskId)) return activeTaskId;
  }
  return null;
}

function firstUnavailableLock(task, lockOwners, ownerId) {
  for (const resource of task.resourceLocks || []) {
    const currentOwner = lockOwners.get(resource);
    if (currentOwner && currentOwner !== ownerId) return resource;
  }
  return null;
}

function decision(taskId, state, reason) {
  return Object.freeze({ taskId, state, reason });
}
