import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTaskDag } from '../src/control-plane/dag.mjs';
import { createLockManager } from '../src/control-plane/locks.mjs';
import { evaluateTaskPolicy } from '../src/control-plane/policy-engine.mjs';
import { planRecovery, rebuildStateFromEvents } from '../src/control-plane/recovery.mjs';
import { createRunnerRegistry } from '../src/execution/runner-registry.mjs';
import { createSessionManager } from '../src/execution/session-manager.mjs';
import { createLocalWorkspaceProvider, createWorkspaceManager } from '../src/execution/workspace-manager.mjs';
import { createTaskExecutor } from '../src/execution/task-executor.mjs';

const inputHash = `sha256:${'8'.repeat(64)}`;

function task(taskId = 'task-resilience', overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId,
    workflowId: 'workflow-resilience',
    workstreamId: `workstream-${taskId}`,
    ownerAgent: 'developer-agent',
    goal: `Execute ${taskId}`,
    requirementIds: ['REQ-RESILIENCE'],
    inputHash,
    dependsOn: [],
    softDependsOn: [],
    conflictsWith: [],
    resourceLocks: ['resource:shared'],
    consumes: [],
    produces: [],
    editablePaths: [`src/${taskId}/**`],
    forbiddenPaths: ['src/secrets/**'],
    acceptanceCommands: ['node --test'],
    requiredTests: ['unit'],
    contextManifestId: `context-${taskId}`,
    status: 'READY',
    attempt: 0,
    maxAttempts: 2,
    ...overrides,
  };
}

function agentContract() {
  return {
    schemaVersion: '1.0',
    entityType: 'AGENT_CONTRACT',
    agentId: 'developer-agent',
    role: 'Developer',
    capabilities: ['CODE_EDIT'],
    allowedTools: ['shell'],
    editablePaths: ['src/**'],
    forbiddenPaths: ['src/secrets/**'],
    outputSchemaId: 'https://moreagent.dev/schemas/execution.schema.json#/$defs/agentResult',
  };
}

function executionOptions(overrides = {}) {
  return {
    task: task(),
    agentContract: agentContract(),
    runnerId: 'blocking-runner',
    workspaceProviderId: 'local',
    projectId: 'project-resilience',
    baseCommit: 'basecommit1234567',
    requestedTools: ['shell'],
    requestedPaths: ['src/task-resilience/index.mjs'],
    policy: { autoEnabled: false },
    ...overrides,
  };
}

test('simultaneous duplicate Task execution is rejected while the first Attempt owns the lock', async () => {
  let releaseRunner;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const runnerFinished = new Promise((resolve) => { releaseRunner = resolve; });
  let runnerCalls = 0;
  const runner = {
    runnerId: 'blocking-runner',
    runnerType: 'SYNTHETIC',
    capabilities: ['AGENT'],
    async execute(request) {
      runnerCalls += 1;
      signalStarted();
      await runnerFinished;
      return {
        status: 'SUCCEEDED',
        exitCode: 0,
        stdout: '',
        stderr: '',
        parsedOutput: {
          changedFiles: ['src/task-resilience/index.mjs'],
          implementedRequirementIds: ['REQ-RESILIENCE'],
          artifactIds: [],
          testsRun: [],
          issueIds: [],
          knownRisks: [],
          sourceCommit: 'taskcommit1234567',
        },
      };
    },
  };

  const lockManager = createLockManager();
  const executor = createTaskExecutor({
    runnerRegistry: createRunnerRegistry([runner]),
    sessionManager: createSessionManager(),
    workspaceManager: createWorkspaceManager({ providers: [createLocalWorkspaceProvider({ rootPath: process.cwd() })] }),
    lockManager,
    heartbeatIntervalMs: 20,
    leaseMs: 200,
  });

  const firstPromise = executor.execute(executionOptions());
  await started;
  const duplicate = await executor.execute(executionOptions());
  assert.equal(duplicate.failureReason, 'lock_conflict');
  assert.equal(duplicate.attempt.status, 'BLOCKED');
  assert.equal(runnerCalls, 1);

  releaseRunner();
  const first = await firstPromise;
  assert.equal(first.run.status, 'SUCCEEDED');
  assert.equal(lockManager.snapshot().length, 0);
});

test('scope, Secret, Tool, budget and Auto violations are rejected before Runner or Workspace creation', async () => {
  let runnerCalls = 0;
  let workspaceCreates = 0;
  const runner = {
    runnerId: 'blocking-runner',
    runnerType: 'SYNTHETIC',
    capabilities: ['AGENT'],
    async execute() {
      runnerCalls += 1;
      return { status: 'SUCCEEDED', exitCode: 0, stdout: '', stderr: '' };
    },
  };
  const workspaceManager = createWorkspaceManager({
    providers: [{
      providerId: 'local',
      workspaceType: 'LOCAL',
      async create() {
        workspaceCreates += 1;
        return { path: process.cwd() };
      },
      async release() {},
    }],
  });
  const lockManager = createLockManager();
  const executor = createTaskExecutor({
    runnerRegistry: createRunnerRegistry([runner]),
    sessionManager: createSessionManager(),
    workspaceManager,
    lockManager,
    heartbeatIntervalMs: 20,
    leaseMs: 200,
  });

  await assert.rejects(
    () => executor.execute(executionOptions({
      requestedTools: ['database-admin'],
      requestedPaths: ['src/secrets/token.txt'],
      executionMode: 'auto',
      budgetUsage: { tokens: 101, cost: 2 },
      task: task('task-resilience', { budget: { maxTokens: 100, maxCost: 1 } }),
    })),
    (error) => error.code === 'POLICY_DENIED' && error.violations.length >= 5,
  );
  assert.equal(runnerCalls, 0);
  assert.equal(workspaceCreates, 0);
  assert.equal(lockManager.snapshot().length, 0);

  const policy = evaluateTaskPolicy({
    task: task(),
    agentContract: agentContract(),
    requestedTools: ['shell'],
    requestedPaths: ['src/task-resilience/index.mjs'],
    executionMode: 'single',
    policy: { autoEnabled: false },
  });
  assert.equal(policy.allowed, true);
});

test('deterministic DAG property checks accept acyclic graphs and reject injected cycles', () => {
  for (let size = 1; size <= 40; size += 1) {
    const tasks = [];
    for (let index = 0; index < size; index += 1) {
      const taskId = `task-${size}-${index}`;
      const dependencyId = index === 0 ? null : `task-${size}-${Math.floor((index - 1) / 2)}`;
      tasks.push(task(taskId, {
        dependsOn: dependencyId ? [dependencyId] : [],
        resourceLocks: [`resource:${taskId}`],
        editablePaths: [`src/generated/${taskId}/**`],
        produces: [`artifact-${taskId}`],
        consumes: dependencyId ? [`artifact-${dependencyId}`] : [],
      }));
    }
    const result = validateTaskDag({ tasks });
    assert.equal(result.valid, true, `acyclic graph of size ${size} must be valid`);
    assert.equal(result.topologicalOrder.length, size);
  }

  const cyclic = [
    task('cycle-a', { dependsOn: ['cycle-c'], editablePaths: ['src/cycle/a/**'], resourceLocks: ['cycle:a'] }),
    task('cycle-b', { dependsOn: ['cycle-a'], editablePaths: ['src/cycle/b/**'], resourceLocks: ['cycle:b'] }),
    task('cycle-c', { dependsOn: ['cycle-b'], editablePaths: ['src/cycle/c/**'], resourceLocks: ['cycle:c'] }),
  ];
  const result = validateTaskDag({ tasks: cyclic });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'DAG_CYCLE'));
});

test('event replay is idempotent and rejects a corrupted state base', () => {
  const workflow = {
    workflowId: 'workflow-resilience',
    projectId: 'project-resilience',
    phase: 'INTAKE',
    status: 'READY',
    version: 0,
  };
  const transitionEvent = {
    eventId: 'event-transition-1',
    eventType: 'workflow.transitioned',
    idempotencyKey: 'workflow-resilience:transition:1',
    occurredAt: '2026-07-14T00:20:00.000Z',
    payload: {
      fromPhase: 'INTAKE',
      toPhase: 'PRODUCT_DESIGN',
      fromStatus: 'READY',
      toStatus: 'RUNNING',
      nextVersion: 1,
    },
  };
  const replayed = rebuildStateFromEvents({
    workflow,
    events: [transitionEvent, { ...transitionEvent, eventId: 'event-transition-duplicate' }],
  });
  assert.equal(replayed.workflow.phase, 'PRODUCT_DESIGN');
  assert.deepEqual(replayed.duplicateEventIds, ['event-transition-duplicate']);

  assert.throws(
    () => rebuildStateFromEvents({ workflow: { ...workflow, phase: 'TECHNICAL_DESIGN' }, events: [transitionEvent] }),
    (error) => error.code === 'WORKFLOW_EVENT_BASE_MISMATCH',
  );
});

test('recovery resumes side-effect-free Attempts but blocks irreversible side-effect replay', () => {
  const current = Date.parse('2026-07-14T00:30:00.000Z');
  const recovery = planRecovery({
    now: current,
    heartbeatTimeoutMs: 1_000,
    sessions: [
      { sessionId: 'session-stale', status: 'ACTIVE', lastHeartbeatAt: '2026-07-14T00:00:00.000Z' },
    ],
    runs: [
      { runId: 'run-safe', taskId: 'task-safe', status: 'RUNNING', sessionId: 'session-stale', sideEffectsCommitted: false },
      { runId: 'run-unsafe', taskId: 'task-unsafe', status: 'RUNNING', sessionId: 'session-stale', sideEffectsCommitted: true },
    ],
    locks: [
      { resource: 'resource:expired', ownerId: 'attempt-old', leaseUntil: current - 1 },
    ],
  });

  assert.equal(recovery.safeToResume, false);
  assert.deepEqual(recovery.resumableRunIds, ['run-safe']);
  assert.deepEqual(recovery.blockedRunIds, ['run-unsafe']);
  assert.deepEqual(recovery.expiredLocks, ['resource:expired']);
  assert.ok(recovery.actions.some((action) => action.type === 'BLOCK_FOR_SIDE_EFFECT_RECONCILIATION'));
});
