import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AcceptanceStatus,
  AcceptanceType,
  ArtifactStatus,
  AttemptStatus,
  AttemptType,
  DecisionType,
  GateConclusion,
  IssueSeverity,
  IssueStatus,
  ProjectType,
  RunStatus,
  TaskStatus,
  WorkflowPhase,
  WorkflowStatus,
  WorkstreamStatus,
} from '../src/domain/enums.mjs';
import { createSchemaRegistry, SCHEMA_FILES } from '../src/contracts/schema-registry.mjs';

const hash = `sha256:${'1'.repeat(64)}`;
const now = '2026-07-13T16:00:00.000Z';

function values(enumObject) {
  return Object.values(enumObject);
}

test('common JSON Schema enums match canonical Domain enums', async () => {
  const common = JSON.parse(await readFile(path.resolve('schemas/common.schema.json'), 'utf8'));
  const defs = common.$defs;
  assert.deepEqual(defs.projectType.enum, values(ProjectType));
  assert.deepEqual(defs.workflowPhase.enum, values(WorkflowPhase));
  assert.deepEqual(defs.workflowStatus.enum, values(WorkflowStatus));
  assert.deepEqual(defs.taskStatus.enum, values(TaskStatus));
  assert.deepEqual(defs.runStatus.enum, values(RunStatus));
  assert.deepEqual(defs.gateConclusion.enum, values(GateConclusion));
  assert.deepEqual(defs.issueSeverity.enum, values(IssueSeverity));
  assert.deepEqual(defs.issueStatus.enum, values(IssueStatus));
  assert.deepEqual(defs.decisionType.enum, values(DecisionType));
  assert.deepEqual(defs.artifactStatus.enum, values(ArtifactStatus));
  assert.deepEqual(defs.acceptanceType.enum, values(AcceptanceType));
  assert.deepEqual(defs.acceptanceStatus.enum, values(AcceptanceStatus));
});

test('work schema enums match Workstream and Attempt Domain enums', async () => {
  const work = JSON.parse(await readFile(path.resolve('schemas/work.schema.json'), 'utf8'));
  assert.deepEqual(work.$defs.workstream.properties.status.enum, values(WorkstreamStatus));
  assert.deepEqual(work.$defs.attempt.properties.attemptType.enum, values(AttemptType));
  assert.deepEqual(work.$defs.attempt.properties.status.enum, values(AttemptStatus));
});

test('validates Workstream and Attempt as independent lifecycle entities', async () => {
  const registry = await createSchemaRegistry();
  const schemaId = 'https://moreagent.dev/schemas/work.schema.json';

  const workstream = {
    schemaVersion: '1.0',
    entityType: 'WORKSTREAM',
    workstreamId: 'workstream-demo',
    workflowId: 'workflow-demo',
    ownerAgent: 'backend-agent',
    status: WorkstreamStatus.ACTIVE,
    taskIds: ['task-demo'],
    currentTaskId: 'task-demo',
    sessionId: null,
    workspaceId: null,
    baselineCommit: 'abcdef1234567',
    inputHash: hash,
    activeIssueIds: [],
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(registry.validate(schemaId, workstream).valid, true);

  const attempt = {
    schemaVersion: '1.0',
    entityType: 'ATTEMPT',
    attemptId: 'attempt-demo-1',
    taskId: 'task-demo',
    workstreamId: 'workstream-demo',
    runId: null,
    attemptNumber: 1,
    attemptType: AttemptType.INITIAL,
    status: AttemptStatus.PLANNED,
    inputHash: hash,
    issueIds: [],
    startedAt: now,
    finishedAt: null,
  };
  assert.equal(registry.validate(schemaId, attempt).valid, true);

  assert.equal(registry.validate(schemaId, { ...attempt, attemptNumber: 0 }).valid, false);
});

test('portable schemas contain no BossResume-specific vocabulary', async () => {
  for (const file of SCHEMA_FILES) {
    const content = await readFile(path.resolve('schemas', file), 'utf8');
    assert.equal(/bossresume/i.test(content), false, `${file} contains BossResume-specific vocabulary`);
  }
});
