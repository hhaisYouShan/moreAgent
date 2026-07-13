import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionWorkflow } from '../src/control-plane/workflow-engine.mjs';
import { validateTaskDag } from '../src/control-plane/dag.mjs';
import { scheduleTasks } from '../src/control-plane/scheduler.mjs';
import { createLockManager } from '../src/control-plane/locks.mjs';
import { evaluateGate } from '../src/control-plane/gate-engine.mjs';
import { evaluateTaskPolicy } from '../src/control-plane/policy-engine.mjs';
import { evaluateConvergence, planRecovery, rebuildStateFromEvents } from '../src/control-plane/recovery.mjs';

const hash = `sha256:${'2'.repeat(64)}`;
const now = '2026-07-13T16:30:00.000Z';

function workflow(overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'WORKFLOW',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    traceId: 'trace-1',
    phase: 'INTAKE',
    status: 'READY',
    version: 0,
    updatedAt: now,
    ...overrides,
  };
}

function task(taskId, overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId,
    workflowId: 'workflow-1',
    workstreamId: `workstream-${taskId}`,
    ownerAgent: 'developer-agent',
    goal: `Deliver ${taskId}`,
    requirementIds: ['REQ-1'],
    inputHash: hash,
    dependsOn: [],
    softDependsOn: [],
    conflictsWith: [],
    resourceLocks: [],
    consumes: [],
    produces: [],
    editablePaths: [`src/${taskId}`],
    forbiddenPaths: [],
    acceptanceCommands: ['npm test'],
    requiredTests: ['unit'],
    contextManifestId: `context-${taskId}`,
    status: 'DRAFT',
    maxAttempts: 2,
    ...overrides,
  };
}

test('workflow engine permits legal transitions and rejects phase skipping', () => {
  const first = transitionWorkflow({ workflow: workflow(), toPhase: 'PRODUCT_DESIGN', toStatus: 'RUNNING', actor: 'control-plane', reason: 'intake approved', at: now });
  assert.equal(first.workflow.phase, 'PRODUCT_DESIGN');
  assert.equal(first.workflow.version, 1);
  assert.equal(first.event.eventType, 'workflow.transitioned');
  assert.throws(
    () => transitionWorkflow({ workflow: workflow(), toPhase: 'IMPLEMENTATION', toStatus: 'RUNNING', actor: 'control-plane', reason: 'skip' }),
    (error) => error.code === 'INVALID_PHASE_TRANSITION',
  );

  const archived = transitionWorkflow({
    workflow: workflow({ phase: 'MAINTENANCE', status: 'COMPLETED' }),
    toPhase: 'ARCHIVED',
    toStatus: 'ARCHIVED',
    actor: 'control-plane',
    reason: 'retention complete',
  });
  assert.equal(archived.workflow.status, 'ARCHIVED');
});

test('DAG validator rejects cycles, missing artifact dependencies and undeclared write conflicts', () => {
  const cycle = validateTaskDag({
    tasks: [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })],
  });
  assert.equal(cycle.valid, false);
  assert.ok(cycle.errors.some((error) => error.code === 'DAG_CYCLE'));

  const missingArtifactDependency = validateTaskDag({
    tasks: [
      task('producer', { produces: ['artifact-api'] }),
      task('consumer', { consumes: ['artifact-api'] }),
    ],
  });
  assert.ok(missingArtifactDependency.errors.some((error) => error.code === 'MISSING_ARTIFACT_DEPENDENCY'));

  const writeConflict = validateTaskDag({
    tasks: [
      task('left', { editablePaths: ['src/shared'] }),
      task('right', { editablePaths: ['src/shared/file.mjs'] }),
    ],
  });
  assert.ok(writeConflict.errors.some((error) => error.code === 'UNDECLARED_WRITE_CONFLICT'));
});

test('DAG validator returns deterministic execution levels', () => {
  const result = validateTaskDag({
    tasks: [
      task('foundation', { produces: ['artifact-foundation'], status: 'APPROVED' }),
      task('frontend', { dependsOn: ['foundation'], consumes: ['artifact-foundation'] }),
      task('backend', { dependsOn: ['foundation'], consumes: ['artifact-foundation'] }),
      task('integration', { dependsOn: ['frontend', 'backend'] }),
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.levels, [['foundation'], ['backend', 'frontend'], ['integration']]);
});

test('scheduler calculates READY tasks through dependency, lock and duplicate guards', () => {
  const tasks = [
    task('foundation', { status: 'APPROVED' }),
    task('api', { dependsOn: ['foundation'], resourceLocks: ['db:schema'] }),
    task('ui', { dependsOn: ['foundation'] }),
  ];
  const result = scheduleTasks({
    tasks,
    maxConcurrent: 2,
    heldLocks: [{ resource: 'db:schema', ownerId: 'other-task' }],
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.assignments.map((assignment) => assignment.taskId), ['ui']);
  assert.ok(result.decisions.some((item) => item.taskId === 'api' && item.reason === 'resource_locked:db:schema'));

  const duplicate = scheduleTasks({
    tasks: [task('api', { status: 'READY' })],
    activeRuns: [{ taskId: 'other', status: 'RUNNING', executionKey: `workflow-1:api:${hash}:single` }],
  });
  assert.ok(duplicate.decisions.some((item) => item.reason === 'duplicate_execution_key'));
});

test('lock manager acquires atomically, heartbeats and reaps expired leases', () => {
  let clock = 1_000;
  const manager = createLockManager({ now: () => clock });
  const acquired = manager.acquire({ resources: ['db:schema', 'route:/jobs'], ownerId: 'task-a', leaseMs: 100 });
  assert.equal(acquired.acquired, true);
  const conflict = manager.acquire({ resources: ['db:schema'], ownerId: 'task-b', leaseMs: 100 });
  assert.equal(conflict.acquired, false);
  clock = 1_050;
  assert.equal(manager.heartbeat({ ownerId: 'task-a', leaseMs: 100 }).length, 2);
  clock = 1_151;
  assert.equal(manager.reapExpired().length, 2);
  assert.equal(manager.ownerOf('db:schema'), null);
});

test('gate engine never lets reviewer recommendations override deterministic failures', () => {
  const gate = evaluateGate({
    gateId: 'gate-1',
    gateType: 'TEST_GATE',
    workflowId: 'workflow-1',
    phase: 'SYSTEM_TEST',
    registeredGates: ['TEST_GATE'],
    deterministicChecks: [{ checkId: 'tests', status: 'FAIL', reason: 'tests_failed' }],
    reviewerRecommendations: [{ reviewer: 'review-agent', conclusion: 'APPROVED' }],
    now: () => now,
  });
  assert.equal(gate.conclusion, 'CHANGES_REQUESTED');
  assert.equal(gate.allowsNextStage, false);
});

test('policy engine enforces owner, tools, paths, budget, context and auto mode', () => {
  const result = evaluateTaskPolicy({
    task: task('secure', { ownerAgent: 'developer-agent', budget: { maxTokens: 100, maxCost: 1 } }),
    agentContract: {
      agentId: 'developer-agent',
      allowedTools: ['shell'],
      editablePaths: ['src/secure/**'],
      forbiddenPaths: ['src/secure/secrets'],
    },
    requestedTools: ['shell', 'database-admin'],
    requestedPaths: ['src/secure/index.mjs', 'src/secure/secrets/key.txt'],
    budgetUsage: { tokens: 101, cost: 1.2 },
    executionMode: 'auto',
    policy: { autoEnabled: false },
  });
  assert.equal(result.allowed, false);
  const codes = result.violations.map((violation) => violation.code);
  assert.ok(codes.includes('TOOL_NOT_ALLOWED'));
  assert.ok(codes.includes('FORBIDDEN_PATH'));
  assert.ok(codes.includes('TOKEN_BUDGET_EXCEEDED'));
  assert.ok(codes.includes('COST_BUDGET_EXCEEDED'));
  assert.ok(codes.includes('AUTO_DISABLED'));
});

test('recovery rebuild is idempotent and blocks unsafe side-effect replay', () => {
  const transitioned = transitionWorkflow({ workflow: workflow(), toPhase: 'PRODUCT_DESIGN', toStatus: 'RUNNING', actor: 'control-plane', reason: 'go', at: now });
  const rebuilt = rebuildStateFromEvents({
    workflow: workflow(),
    events: [transitioned.event, { ...transitioned.event, eventId: 'duplicate-event' }],
  });
  assert.equal(rebuilt.workflow.phase, 'PRODUCT_DESIGN');
  assert.deepEqual(rebuilt.duplicateEventIds, ['duplicate-event']);

  const recovery = planRecovery({
    now: Date.parse(now),
    heartbeatTimeoutMs: 1_000,
    sessions: [{ sessionId: 'session-1', status: 'ACTIVE', lastHeartbeatAt: '2026-07-13T16:00:00.000Z' }],
    runs: [
      { runId: 'run-safe', taskId: 'task-a', status: 'RUNNING', sessionId: 'session-1', sideEffectsCommitted: false },
      { runId: 'run-unsafe', taskId: 'task-b', status: 'RUNNING', sessionId: 'session-1', sideEffectsCommitted: true },
    ],
    locks: [{ resource: 'db:schema', ownerId: 'task-a', leaseUntil: Date.parse(now) - 1 }],
  });
  assert.equal(recovery.safeToResume, false);
  assert.ok(recovery.resumableRunIds.includes('run-safe'));
  assert.ok(recovery.blockedRunIds.includes('run-unsafe'));
  assert.equal(evaluateConvergence({ attemptCount: 3, maxAttempts: 3 }).reason, 'max_attempts_reached');
});
