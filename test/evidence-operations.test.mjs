import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArtifactRegistry } from '../src/evidence/artifact-registry.mjs';
import { createEventStore } from '../src/evidence/event-store.mjs';
import { createTraceRegistry } from '../src/evidence/trace-registry.mjs';
import { createJsonFileStore } from '../src/evidence/json-file-store.mjs';
import { createGitIntegrationService } from '../src/integration/git-integration-service.mjs';
import { createReleaseService } from '../src/release/release-service.mjs';
import { createMaintenanceWorkflowSeed, routeMaintenanceItem } from '../src/maintenance/maintenance-router.mjs';
import { createSchemaRegistry } from '../src/contracts/schema-registry.mjs';

const evidenceSchema = 'https://moreagent.dev/schemas/evidence.schema.json';
const operationsSchema = 'https://moreagent.dev/schemas/operations.schema.json';
const hash = `sha256:${'4'.repeat(64)}`;
const now = '2026-07-13T18:00:00.000Z';

function event(overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'EVENT',
    eventId: 'event-1',
    eventType: 'task.completed',
    eventVersion: '1.0',
    traceId: 'trace-1',
    projectId: 'project-1',
    workflowId: 'workflow-1',
    taskId: 'task-1',
    runId: 'run-1',
    sessionId: null,
    actor: 'execution-plane',
    occurredAt: now,
    idempotencyKey: 'task-1:run-1:completed',
    payload: {},
    ...overrides,
  };
}

test('Artifact Registry preserves history and exposes one ACTIVE logical version', async () => {
  const registry = createArtifactRegistry({ now: () => now });
  const first = registry.register({
    projectId: 'project-1', workflowId: 'workflow-1', logicalKey: 'design/api', artifactType: 'DESIGN',
    content: { version: 1 }, location: 'artifacts/design-v1.json', producedBy: 'architect-agent',
  });
  const second = registry.register({
    projectId: 'project-1', workflowId: 'workflow-1', logicalKey: 'design/api', artifactType: 'DESIGN',
    content: { version: 2 }, location: 'artifacts/design-v2.json', producedBy: 'architect-agent',
  });

  assert.equal(registry.get(first.artifactId).status, 'SUPERSEDED');
  assert.equal(registry.get(first.artifactId).supersededBy, second.artifactId);
  assert.equal(registry.getActive({ projectId: 'project-1', workflowId: 'workflow-1', logicalKey: 'design/api' }).artifactId, second.artifactId);
  assert.equal(registry.verifyContent(second.artifactId, { version: 2 }), true);

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(evidenceSchema, registry.get(first.artifactId)).valid, true);
  assert.equal(schemas.validate(evidenceSchema, second).valid, true);
});

test('Event Store is append-only and idempotent', () => {
  const store = createEventStore();
  assert.equal(store.append(event()).appended, true);
  assert.equal(store.append(event({ eventId: 'event-duplicate' })).appended, false);
  assert.equal(store.size, 1);
  assert.equal(store.findByIdempotencyKey('task-1:run-1:completed').eventId, 'event-1');
  assert.throws(
    () => store.append(event({ idempotencyKey: 'different-key' })),
    (error) => error.code === 'EVENT_ID_COLLISION',
  );
});

test('Project Map drift invalidates Context and Requirement Trace requires complete links', async () => {
  const registry = createTraceRegistry({ now: () => now });
  const firstMap = registry.registerProjectMap({
    projectId: 'project-1', baseCommit: 'abcdef1234567', modules: [{ id: 'api', path: 'src/api' }],
  });
  const context = registry.createContextManifest({
    taskId: 'task-1', inputHash: hash, projectMapId: firstMap.projectMapId,
    files: [{ path: 'src/api/index.mjs', hash }], editablePaths: ['src/api/**'], forbiddenPaths: [],
  });
  assert.equal(registry.validateContext(context.contextManifestId, { inputHash: hash }).valid, true);

  registry.registerProjectMap({
    projectId: 'project-1', baseCommit: 'fedcba7654321', modules: [{ id: 'api', path: 'src/api-v2' }],
  });
  assert.equal(registry.getContext(context.contextManifestId).status, 'INVALID');
  assert.equal(registry.validateContext(context.contextManifestId, { inputHash: hash }).valid, false);

  registry.upsertRequirementTrace({
    projectId: 'project-1', workflowId: 'workflow-1', requirementId: 'REQ-1',
    links: { designArtifactIds: ['artifact-1'], taskIds: ['task-1'] },
  });
  assert.equal(registry.assessTraceCompleteness({ projectId: 'project-1', workflowId: 'workflow-1', requirementIds: ['REQ-1'] }).complete, false);
  const trace = registry.upsertRequirementTrace({
    projectId: 'project-1', workflowId: 'workflow-1', requirementId: 'REQ-1',
    links: { commitShas: ['abcdef1234567'], testEvidenceIds: ['evidence-test'], gateIds: ['gate-test'], acceptanceIds: ['acceptance-user'] },
  });
  assert.equal(registry.assessTraceCompleteness({ projectId: 'project-1', workflowId: 'workflow-1', requirementIds: ['REQ-1'] }).complete, true);

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(evidenceSchema, registry.getProjectMap(firstMap.projectMapId)).valid, true);
  assert.equal(schemas.validate(evidenceSchema, trace).valid, true);
});

test('JSON file store writes atomically, supports immutable records and prevents path escape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-store-'));
  try {
    const store = createJsonFileStore({ rootPath: root });
    await store.write('runs/run-1.json', { status: 'RUNNING' }, { immutable: true });
    assert.deepEqual(await store.read('runs/run-1.json'), { status: 'RUNNING' });
    assert.match(await readFile(path.join(root, 'runs/run-1.json'), 'utf8'), /RUNNING/);
    await assert.rejects(() => store.write('runs/run-1.json', { status: 'DONE' }, { immutable: true }), (error) => error.code === 'IMMUTABLE_RECORD_EXISTS');
    await assert.rejects(() => store.write('../escape.json', {}), (error) => error.code === 'PATH_ESCAPE_DENIED');
    await store.appendJsonLine('events/events.jsonl', event());
    assert.match(await readFile(path.join(root, 'events/events.jsonl'), 'utf8'), /task.completed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Git Integration creates a real integration commit and validates that commit', async () => {
  const gitCalls = [];
  const service = createGitIntegrationService({
    now: () => now,
    runGit({ cwd, args }) {
      gitCalls.push({ cwd, args });
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'integration1234567', stderr: '' };
      if (args[0] === 'diff' && args.includes('--name-only') && !args.includes('--diff-filter=U')) return { exitCode: 0, stdout: 'src/api.mjs\ntest/api.test.mjs', stderr: '' };
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    async runCommand() {
      return { exitCode: 0, stdout: 'tests passed', stderr: '' };
    },
  });

  const result = await service.integrate({
    projectId: 'project-1', workflowId: 'workflow-1', projectRoot: '/repo', baseCommit: 'base1234567',
    taskCommits: ['task1111111', 'task2222222'], integrationBranch: 'integration/workflow-1', integrationWorktreePath: '/repo/.worktrees/integration',
    requirementIds: ['REQ-1'], verificationCommands: [{ command: 'npm', args: ['test'] }], cleanupWorktree: true,
  });

  assert.equal(result.passed, true);
  assert.equal(result.evidence.integrationCommit, 'integration1234567');
  assert.deepEqual(result.evidence.changedFiles, ['src/api.mjs', 'test/api.test.mjs']);
  assert.ok(gitCalls.filter((call) => call.args[0] === 'merge').length === 2);
  assert.ok(!gitCalls.some((call) => call.args[0] === 'checkout' && call.args.includes('--')));

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(evidenceSchema, result.evidence).valid, true);
});

test('Git Integration returns conflict evidence without a fake integration commit', async () => {
  let mergeCount = 0;
  const service = createGitIntegrationService({
    now: () => now,
    runGit({ args }) {
      if (args[0] === 'merge' && args[1] !== '--abort') {
        mergeCount += 1;
        return mergeCount === 2
          ? { exitCode: 1, stdout: '', stderr: 'CONFLICT' }
          : { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (args.includes('--diff-filter=U')) return { exitCode: 0, stdout: 'src/conflict.mjs', stderr: '' };
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });
  const result = await service.integrate({
    projectId: 'project-1', workflowId: 'workflow-1', projectRoot: '/repo', baseCommit: 'base1234567',
    taskCommits: ['task1111111', 'task2222222'], integrationBranch: 'integration/workflow-1', integrationWorktreePath: '/repo/.worktrees/integration',
  });
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'integration_conflict');
  assert.equal(result.evidence.integrationCommit, null);
  assert.deepEqual(result.evidence.conflicts[0].files, ['src/conflict.mjs']);
  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(evidenceSchema, result.evidence).valid, true);
});

test('Release requires user acceptance and rolls back after failed health checks', async () => {
  const commands = [];
  const service = createReleaseService({
    now: () => now,
    async runCommand(specification) {
      commands.push(specification.command);
      return specification.command === 'health'
        ? { exitCode: 1, stdout: '', stderr: 'unhealthy' }
        : { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });

  await assert.rejects(
    () => service.release({
      releaseId: 'release-1', projectId: 'project-1', workflowId: 'workflow-1', integrationCommit: 'integration1234567', targetEnvironment: 'production',
      userAcceptance: { acceptanceType: 'USER', status: 'PENDING' }, rollbackPlan: 'rollback immediately',
    }),
    (error) => error.code === 'USER_ACCEPTANCE_REQUIRED',
  );

  const result = await service.release({
    releaseId: 'release-1', projectId: 'project-1', workflowId: 'workflow-1', integrationCommit: 'integration1234567', targetEnvironment: 'production',
    userAcceptance: { acceptanceId: 'acceptance-user', acceptanceType: 'USER', status: 'APPROVED', baselineCommit: 'integration1234567' },
    migrationCommands: [{ command: 'migrate' }], releaseCommands: [{ command: 'deploy' }], healthChecks: [{ command: 'health' }],
    rollbackCommands: [{ command: 'rollback' }], rollbackPlan: 'rollback immediately', autoRollback: true,
  });

  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(result.rolledBack, true);
  assert.deepEqual(commands, ['migrate', 'deploy', 'health', 'rollback']);

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(evidenceSchema, result.evidence).valid, true);
  assert.equal(schemas.validate(operationsSchema, result.incident).valid, true);
});

test('Maintenance Router requires evidence and creates a controlled workflow seed', async () => {
  const incomplete = routeMaintenanceItem({
    itemId: 'maintenance-1', itemType: 'bug', projectId: 'project-1', workflowId: 'workflow-1', summary: 'API returns 500', evidence: {}, createdAt: now,
  });
  assert.equal(incomplete.status, 'NEEDS_EVIDENCE');
  assert.throws(() => createMaintenanceWorkflowSeed(incomplete), (error) => error.code === 'MAINTENANCE_ITEM_NOT_READY');

  const ready = routeMaintenanceItem({
    itemId: 'maintenance-2', itemType: 'bug', projectId: 'project-1', workflowId: 'workflow-1', summary: 'API returns 500',
    evidence: { reproduction: 'curl /api', 'expected-vs-actual': '200 vs 500' }, createdAt: now,
  });
  const seed = createMaintenanceWorkflowSeed(ready);
  assert.equal(seed.initialPhase, 'IMPLEMENTATION');
  assert.equal(seed.ownerRole, 'developer');

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(operationsSchema, ready).valid, true);
  assert.equal(schemas.validate(operationsSchema, seed).valid, true);
});
