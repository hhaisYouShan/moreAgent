import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchemaRegistry, SCHEMA_FILES } from '../src/contracts/schema-registry.mjs';
import { adaptBossResumeGateResult, adaptBossResumeWorkflowPhase } from '../adapters/bossresume-contracts.mjs';
import { GateConclusion, WorkflowPhase } from '../src/domain/enums.mjs';

const hash = `sha256:${'0'.repeat(64)}`;
const now = '2026-07-13T15:30:00.000Z';

const ids = {
  common: 'https://moreagent.dev/schemas/common.schema.json',
  project: 'https://moreagent.dev/schemas/project.schema.json',
  workflow: 'https://moreagent.dev/schemas/workflow.schema.json',
  task: 'https://moreagent.dev/schemas/task.schema.json',
  execution: 'https://moreagent.dev/schemas/execution.schema.json',
  governance: 'https://moreagent.dev/schemas/governance.schema.json',
  evidence: 'https://moreagent.dev/schemas/evidence.schema.json',
};

test('compiles every registered JSON Schema', async () => {
  const registry = await createSchemaRegistry();
  assert.equal(registry.schemaIds.length, SCHEMA_FILES.length);
  for (const schemaId of Object.values(ids)) assert.ok(registry.getSchema(schemaId));
});

test('accepts valid project, workflow and atomic task contracts', async () => {
  const registry = await createSchemaRegistry();

  const project = {
    schemaVersion: '1.0',
    entityType: 'PROJECT',
    projectId: 'project-demo',
    name: 'Demo Project',
    projectType: 'NEW_PROJECT',
    repository: { provider: 'GITHUB', owner: 'example', name: 'demo' },
    defaultBranch: 'main',
    profileId: 'profile-default',
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(registry.validate(ids.project, project).valid, true);

  const workflow = {
    schemaVersion: '1.0',
    entityType: 'WORKFLOW',
    workflowId: 'workflow-demo',
    projectId: 'project-demo',
    goal: 'Deliver the demo project',
    phase: WorkflowPhase.INTAKE,
    status: 'READY',
    round: 0,
    inputHash: hash,
    requirementIds: ['REQ-1'],
    activeTaskIds: [],
    openIssueIds: [],
    currentGateId: null,
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(registry.validate(ids.workflow, workflow).valid, true);

  const task = {
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId: 'task-demo',
    workflowId: 'workflow-demo',
    workstreamId: 'workstream-demo',
    ownerAgent: 'backend-agent',
    goal: 'Implement one atomic API',
    requirementIds: ['REQ-1'],
    inputHash: hash,
    dependsOn: [],
    softDependsOn: [],
    conflictsWith: [],
    resourceLocks: ['database:schema'],
    consumes: [],
    produces: ['artifact-api'],
    editablePaths: ['server/src/api/'],
    forbiddenPaths: ['client/'],
    acceptanceCommands: ['npm test'],
    requiredTests: ['api contract test'],
    contextManifestId: null,
    status: 'READY',
    attempt: 0,
    maxAttempts: 2,
  };
  assert.equal(registry.validate(ids.task, task).valid, true);
});

test('rejects invalid project-specific or incomplete core contracts', async () => {
  const registry = await createSchemaRegistry();
  const invalidTask = {
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId: 'task-invalid',
    workflowId: 'workflow-demo',
    workstreamId: 'workstream-demo',
    ownerAgent: 'backend-agent',
    goal: 'Invalid because required execution boundaries are absent',
    requirementIds: [],
    inputHash: 'bossresume-special-hash',
    dependsOn: [],
    conflictsWith: [],
    resourceLocks: [],
    status: 'READY',
    maxAttempts: 0,
  };
  const result = registry.validate(ids.task, invalidTask);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('validates execution, governance and evidence entity families', async () => {
  const registry = await createSchemaRegistry();

  const run = {
    schemaVersion: '1.0',
    entityType: 'RUN',
    runId: 'run-1',
    taskId: 'task-demo',
    attempt: 1,
    executionKey: 'project-demo:task-demo:hash:single',
    status: 'RUNNING',
    sessionId: null,
    workspaceId: null,
    startedAt: now,
    finishedAt: null,
    exitCode: null,
  };
  assert.equal(registry.validate(ids.execution, run).valid, true);

  const gate = {
    schemaVersion: '1.0',
    entityType: 'GATE_RESULT',
    gateId: 'gate-1',
    gateType: 'TEST_GATE',
    workflowId: 'workflow-demo',
    phase: 'SYSTEM_TEST',
    conclusion: GateConclusion.APPROVED,
    inputArtifactIds: ['artifact-test'],
    issueIds: [],
    openBlockingCount: 0,
    openMajorCount: 0,
    allowsNextStage: true,
    failureReason: null,
    decidedAt: now,
    engineVersion: '1.0.0',
  };
  assert.equal(registry.validate(ids.governance, gate).valid, true);

  const event = {
    schemaVersion: '1.0',
    entityType: 'EVENT',
    eventId: 'event-1',
    eventType: 'task.started',
    eventVersion: '1.0',
    traceId: 'trace-1',
    projectId: 'project-demo',
    workflowId: 'workflow-demo',
    taskId: 'task-demo',
    runId: 'run-1',
    sessionId: null,
    actor: 'control-plane',
    occurredAt: now,
    idempotencyKey: 'task-demo:run-1:started',
    payload: {},
  };
  assert.equal(registry.validate(ids.evidence, event).valid, true);
});

test('keeps BossResume compatibility vocabulary outside Core', () => {
  const adapted = adaptBossResumeGateResult({ conclusion: 'PASS', issues: [{ severity: 'BLOCKER' }] });
  assert.equal(adapted.conclusion, GateConclusion.APPROVED);
  assert.equal(adapted.issues[0].severity, 'BLOCKING');
  assert.equal(adaptBossResumeWorkflowPhase('TESTING'), WorkflowPhase.SYSTEM_TEST);
});
