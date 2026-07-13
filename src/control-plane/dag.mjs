export function validateTaskDag({ tasks = [], externalArtifactIds = [] } = {}) {
  const errors = [];
  const taskMap = new Map();
  const externalArtifacts = new Set(externalArtifactIds);

  for (const task of tasks) {
    const taskId = task?.taskId;
    if (!taskId) {
      errors.push(problem('TASK_ID_REQUIRED', null, 'Every Task requires taskId.'));
      continue;
    }
    if (taskMap.has(taskId)) {
      errors.push(problem('DUPLICATE_TASK_ID', taskId, `Duplicate taskId: ${taskId}.`));
      continue;
    }
    taskMap.set(taskId, task);
  }

  for (const [taskId, task] of taskMap) {
    for (const dependencyId of array(task.dependsOn)) {
      if (dependencyId === taskId) errors.push(problem('SELF_DEPENDENCY', taskId, 'A Task cannot depend on itself.'));
      else if (!taskMap.has(dependencyId)) errors.push(problem('MISSING_DEPENDENCY', taskId, `Missing dependency: ${dependencyId}.`));
    }
    for (const conflictId of array(task.conflictsWith)) {
      if (conflictId === taskId) errors.push(problem('SELF_CONFLICT', taskId, 'A Task cannot conflict with itself.'));
      else if (!taskMap.has(conflictId)) errors.push(problem('MISSING_CONFLICT_TARGET', taskId, `Missing conflict target: ${conflictId}.`));
    }
  }

  const { order, cyclicTaskIds } = topologicalSort(taskMap);
  if (cyclicTaskIds.length) {
    errors.push(problem('DAG_CYCLE', null, `Task DAG contains a cycle: ${cyclicTaskIds.join(', ')}.`, { taskIds: cyclicTaskIds }));
  }

  const ancestors = buildAncestors(taskMap);
  const producers = new Map();
  for (const [taskId, task] of taskMap) {
    for (const artifactId of array(task.produces)) {
      const existing = producers.get(artifactId);
      if (existing) errors.push(problem('DUPLICATE_ARTIFACT_PRODUCER', taskId, `${artifactId} is produced by both ${existing} and ${taskId}.`));
      else producers.set(artifactId, taskId);
    }
  }

  for (const [taskId, task] of taskMap) {
    for (const artifactId of array(task.consumes)) {
      if (externalArtifacts.has(artifactId)) continue;
      const producerId = producers.get(artifactId);
      if (!producerId) {
        errors.push(problem('MISSING_ARTIFACT_PRODUCER', taskId, `No Task or external input produces ${artifactId}.`));
      } else if (!ancestors.get(taskId)?.has(producerId)) {
        errors.push(problem('MISSING_ARTIFACT_DEPENDENCY', taskId, `${taskId} consumes ${artifactId} from ${producerId} without a dependency path.`));
      }
    }
  }

  const entries = [...taskMap.entries()];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const [leftId, left] = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [rightId, right] = entries[rightIndex];
      if (ordered(ancestors, leftId, rightId)) continue;
      if (declaredConflict(left, rightId) || declaredConflict(right, leftId)) continue;
      if (sharesLock(left, right)) continue;
      const overlappingPaths = pathOverlaps(array(left.editablePaths), array(right.editablePaths));
      if (overlappingPaths.length) {
        errors.push(problem('UNDECLARED_WRITE_CONFLICT', null, `${leftId} and ${rightId} have overlapping editable paths without dependency, conflict, or shared lock.`, {
          taskIds: [leftId, rightId],
          paths: overlappingPaths,
        }));
      }
    }
  }

  const levels = cyclicTaskIds.length ? [] : buildLevels(order, taskMap);
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    topologicalOrder: Object.freeze(order),
    levels: Object.freeze(levels.map((level) => Object.freeze(level))),
  });
}

export function executionKey(task, mode = 'single') {
  if (!task?.taskId || !task?.inputHash) throw new TypeError('taskId and inputHash are required to build an execution key');
  return `${task.workflowId || 'workflow'}:${task.taskId}:${task.inputHash}:${mode}`;
}

function topologicalSort(taskMap) {
  const indegree = new Map([...taskMap.keys()].map((taskId) => [taskId, 0]));
  const outgoing = new Map([...taskMap.keys()].map((taskId) => [taskId, []]));
  for (const [taskId, task] of taskMap) {
    for (const dependencyId of array(task.dependsOn)) {
      if (!taskMap.has(dependencyId) || dependencyId === taskId) continue;
      indegree.set(taskId, indegree.get(taskId) + 1);
      outgoing.get(dependencyId).push(taskId);
    }
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([taskId]) => taskId).sort();
  const order = [];
  while (queue.length) {
    const taskId = queue.shift();
    order.push(taskId);
    for (const childId of outgoing.get(taskId)) {
      const next = indegree.get(childId) - 1;
      indegree.set(childId, next);
      if (next === 0) {
        queue.push(childId);
        queue.sort();
      }
    }
  }

  return {
    order,
    cyclicTaskIds: [...indegree.entries()].filter(([, degree]) => degree > 0).map(([taskId]) => taskId).sort(),
  };
}

function buildAncestors(taskMap) {
  const memo = new Map();
  const visit = (taskId, visiting = new Set()) => {
    if (memo.has(taskId)) return memo.get(taskId);
    if (visiting.has(taskId)) return new Set();
    visiting.add(taskId);
    const result = new Set();
    const task = taskMap.get(taskId);
    for (const dependencyId of array(task?.dependsOn)) {
      if (!taskMap.has(dependencyId)) continue;
      result.add(dependencyId);
      for (const ancestorId of visit(dependencyId, visiting)) result.add(ancestorId);
    }
    visiting.delete(taskId);
    memo.set(taskId, result);
    return result;
  };
  for (const taskId of taskMap.keys()) visit(taskId);
  return memo;
}

function buildLevels(order, taskMap) {
  const levelByTask = new Map();
  for (const taskId of order) {
    const dependencies = array(taskMap.get(taskId)?.dependsOn).filter((dependencyId) => taskMap.has(dependencyId));
    const level = dependencies.length ? Math.max(...dependencies.map((dependencyId) => levelByTask.get(dependencyId) || 0)) + 1 : 0;
    levelByTask.set(taskId, level);
  }
  const levels = [];
  for (const taskId of order) {
    const level = levelByTask.get(taskId);
    if (!levels[level]) levels[level] = [];
    levels[level].push(taskId);
  }
  return levels;
}

function ordered(ancestors, leftId, rightId) {
  return ancestors.get(leftId)?.has(rightId) || ancestors.get(rightId)?.has(leftId);
}

function declaredConflict(task, otherId) {
  return array(task?.conflictsWith).includes(otherId);
}

function sharesLock(left, right) {
  const leftLocks = new Set(array(left?.resourceLocks));
  return array(right?.resourceLocks).some((lock) => leftLocks.has(lock));
}

function pathOverlaps(leftPaths, rightPaths) {
  const result = [];
  for (const leftPath of leftPaths.map(normalizePath).filter(Boolean)) {
    for (const rightPath of rightPaths.map(normalizePath).filter(Boolean)) {
      if (leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`)) {
        result.push(`${leftPath} <> ${rightPath}`);
      }
    }
  }
  return [...new Set(result)].sort();
}

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function problem(code, taskId, message, details = {}) {
  return Object.freeze({ code, taskId, message, ...details });
}
