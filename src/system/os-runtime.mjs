import { transitionWorkflow } from '../control-plane/workflow-engine.mjs';
import { validateTaskDag } from '../control-plane/dag.mjs';
import { scheduleTasks } from '../control-plane/scheduler.mjs';
import { evaluateGate, assertGateAllowsTransition } from '../control-plane/gate-engine.mjs';
import { TaskStatus } from '../domain/enums.mjs';

const SCHEMAS = Object.freeze({
  project: 'https://moreagent.dev/schemas/project.schema.json',
  workflow: 'https://moreagent.dev/schemas/workflow.schema.json',
  task: 'https://moreagent.dev/schemas/task.schema.json',
  governance: 'https://moreagent.dev/schemas/governance.schema.json',
});

export function createOsRuntime({
  schemaRegistry,
  taskExecutor,
  eventStore,
  artifactRegistry,
  traceRegistry,
  integrationService,
  releaseService,
  registeredGates = [],
  now = () => new Date().toISOString(),
} = {}) {
  for (const [name, value] of Object.entries({ schemaRegistry, taskExecutor, eventStore, artifactRegistry, traceRegistry, integrationService, releaseService })) {
    if (!value) throw new TypeError(`${name} is required`);
  }

  const projects = new Map();
  const workflows = new Map();
  const tasksByWorkflow = new Map();
  const gates = new Map();
  const acceptances = new Map();
  const integrations = new Map();
  const releases = new Map();

  return Object.freeze({
    registerProject(project) {
      schemaRegistry.assert(SCHEMAS.project, project);
      if (projects.has(project.projectId)) throw runtimeError('PROJECT_ALREADY_EXISTS', `Project already exists: ${project.projectId}.`);
      projects.set(project.projectId, freeze(project));
      return projects.get(project.projectId);
    },

    createWorkflow(workflow) {
      schemaRegistry.assert(SCHEMAS.workflow, workflow);
      if (!projects.has(workflow.projectId)) throw runtimeError('PROJECT_NOT_FOUND', `Project not found: ${workflow.projectId}.`);
      if (workflows.has(workflow.workflowId)) throw runtimeError('WORKFLOW_ALREADY_EXISTS', `Workflow already exists: ${workflow.workflowId}.`);
      workflows.set(workflow.workflowId, freeze({ ...workflow, version: Number(workflow.version || 0) }));
      tasksByWorkflow.set(workflow.workflowId, new Map());
      appendEvent('workflow.created', workflow, { workflow: workflows.get(workflow.workflowId) });
      return workflows.get(workflow.workflowId);
    },

    addTasks(workflowId, tasks, { externalArtifactIds = [] } = {}) {
      requireWorkflow(workflowId);
      if (!Array.isArray(tasks) || !tasks.length) throw new TypeError('tasks must be a non-empty array');
      for (const task of tasks) {
        schemaRegistry.assert(SCHEMAS.task, task);
        if (task.workflowId !== workflowId) throw runtimeError('TASK_WORKFLOW_MISMATCH', `${task.taskId} belongs to ${task.workflowId}, expected ${workflowId}.`);
      }
      const existing = tasksByWorkflow.get(workflowId);
      const combined = [...existing.values(), ...tasks];
      const dag = validateTaskDag({ tasks: combined, externalArtifactIds });
      if (!dag.valid) {
        const error = runtimeError('TASK_DAG_INVALID', 'Task DAG is invalid.');
        error.dagErrors = dag.errors;
        throw error;
      }
      for (const task of tasks) {
        if (existing.has(task.taskId)) throw runtimeError('TASK_ALREADY_EXISTS', `Task already exists: ${task.taskId}.`);
        existing.set(task.taskId, freeze({ ...task, version: Number(task.version || 0) }));
        appendEvent('task.created', requireWorkflow(workflowId), { task: existing.get(task.taskId) }, task.taskId);
      }
      return dag;
    },

    transition(workflowId, { toPhase, toStatus, actor = 'control-plane', reason }) {
      const current = requireWorkflow(workflowId);
      const result = transitionWorkflow({ workflow: current, toPhase, toStatus, actor, reason, at: timestamp(now) });
      workflows.set(workflowId, result.workflow);
      eventStore.append(result.event);
      return result.workflow;
    },

    schedule(workflowId, options = {}) {
      requireWorkflow(workflowId);
      return scheduleTasks({ tasks: [...tasksByWorkflow.get(workflowId).values()], ...options });
    },

    async executeAssignments(workflowId, assignments, executionOptionsByTask = {}) {
      requireWorkflow(workflowId);
      if (!Array.isArray(assignments)) throw new TypeError('assignments must be an array');
      const taskMap = tasksByWorkflow.get(workflowId);
      const results = await Promise.all(assignments.map(async (assignment) => {
        const task = taskMap.get(assignment.taskId);
        if (!task) throw runtimeError('TASK_NOT_FOUND', `Task not found: ${assignment.taskId}.`);
        updateTask(workflowId, task.taskId, TaskStatus.RUNNING, 'execution_started');
        const result = await taskExecutor.execute({ task, ...executionOptionsByTask[task.taskId] });
        updateTask(workflowId, task.taskId, result.run.status === 'SUCCEEDED' ? TaskStatus.APPROVED : TaskStatus.FAILED, result.failureReason || 'execution_finished');
        return result;
      }));
      return Object.freeze(results);
    },

    evaluateGate(input) {
      const workflow = requireWorkflow(input.workflowId);
      if (workflow.phase !== input.phase) throw runtimeError('GATE_PHASE_MISMATCH', `Workflow phase is ${workflow.phase}, gate phase is ${input.phase}.`);
      const result = evaluateGate({ ...input, registeredGates, now: () => timestamp(now) });
      schemaRegistry.assert(SCHEMAS.governance, result);
      gates.set(result.gateId, result);
      appendEvent('gate.decided', workflow, { gateResult: result });
      return result;
    },

    applyApprovedGate(workflowId, gateId, transition) {
      requireWorkflow(workflowId);
      const gate = gates.get(gateId);
      if (!gate || gate.workflowId !== workflowId) throw runtimeError('GATE_NOT_FOUND', `Gate not found for workflow: ${gateId}.`);
      assertGateAllowsTransition(gate);
      return this.transition(workflowId, transition);
    },

    registerArtifact(input) {
      return artifactRegistry.register(input);
    },

    registerProjectMap(input) {
      return traceRegistry.registerProjectMap(input);
    },

    upsertRequirementTrace(input) {
      return traceRegistry.upsertRequirementTrace(input);
    },

    async integrate(workflowId, input) {
      requireWorkflow(workflowId);
      const result = await integrationService.integrate({ workflowId, ...input });
      integrations.set(workflowId, result);
      appendEvent('integration.completed', requireWorkflow(workflowId), { passed: result.passed, evidenceId: result.evidence.integrationEvidenceId });
      return result;
    },

    recordAcceptance(acceptance) {
      schemaRegistry.assert(SCHEMAS.governance, acceptance);
      if (!workflows.has(acceptance.workflowId)) throw runtimeError('WORKFLOW_NOT_FOUND', `Workflow not found: ${acceptance.workflowId}.`);
      acceptances.set(acceptance.acceptanceId, freeze(acceptance));
      appendEvent('acceptance.recorded', requireWorkflow(acceptance.workflowId), { acceptanceId: acceptance.acceptanceId, type: acceptance.acceptanceType, status: acceptance.status });
      return acceptances.get(acceptance.acceptanceId);
    },

    async release(workflowId, input) {
      requireWorkflow(workflowId);
      const acceptance = acceptances.get(input.userAcceptanceId);
      if (!acceptance) throw runtimeError('USER_ACCEPTANCE_NOT_FOUND', `Acceptance not found: ${input.userAcceptanceId}.`);
      const result = await releaseService.release({ workflowId, userAcceptance: acceptance, ...input });
      releases.set(input.releaseId, result);
      appendEvent('release.completed', requireWorkflow(workflowId), { releaseId: input.releaseId, status: result.status });
      return result;
    },

    snapshot() {
      return freeze({
        projects: [...projects.values()],
        workflows: [...workflows.values()],
        tasks: [...tasksByWorkflow.entries()].flatMap(([, tasks]) => [...tasks.values()]),
        gates: [...gates.values()],
        acceptances: [...acceptances.values()],
        integrations: [...integrations.entries()].map(([workflowId, value]) => ({ workflowId, ...value })),
        releases: [...releases.entries()].map(([releaseId, value]) => ({ releaseId, ...value })),
        events: eventStore.snapshot(),
      });
    },

    getWorkflow(workflowId) {
      return workflows.get(workflowId) || null;
    },

    getTasks(workflowId) {
      return Object.freeze([...(tasksByWorkflow.get(workflowId)?.values() || [])]);
    },
  });

  function updateTask(workflowId, taskId, status, reason) {
    const taskMap = tasksByWorkflow.get(workflowId);
    const current = taskMap.get(taskId);
    if (!current) throw runtimeError('TASK_NOT_FOUND', `Task not found: ${taskId}.`);
    const next = freeze({ ...current, status, updatedAt: timestamp(now), version: Number(current.version || 0) + 1 });
    taskMap.set(taskId, next);
    appendEvent('task.status_changed', requireWorkflow(workflowId), {
      taskId,
      fromStatus: current.status,
      toStatus: status,
      reason,
      previousVersion: Number(current.version || 0),
      nextVersion: next.version,
    }, taskId);
    return next;
  }

  function appendEvent(eventType, workflow, payload, taskId = null) {
    const occurredAt = timestamp(now);
    const sequence = eventStore.size + 1;
    return eventStore.append({
      schemaVersion: '1.0',
      entityType: 'EVENT',
      eventId: `event-${workflow.workflowId}-${sequence}`,
      eventType,
      eventVersion: '1.0',
      traceId: workflow.traceId || workflow.workflowId,
      projectId: workflow.projectId,
      workflowId: workflow.workflowId,
      taskId,
      runId: null,
      sessionId: null,
      actor: 'os-runtime',
      occurredAt,
      idempotencyKey: `${workflow.workflowId}:${eventType}:${sequence}`,
      payload,
    });
  }

  function requireWorkflow(workflowId) {
    const workflow = workflows.get(workflowId);
    if (!workflow) throw runtimeError('WORKFLOW_NOT_FOUND', `Workflow not found: ${workflowId}.`);
    return workflow;
  }
}

function freeze(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
