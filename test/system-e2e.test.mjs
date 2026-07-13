import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchemaRegistry } from '../src/contracts/schema-registry.mjs';
import { createRunnerRegistry } from '../src/execution/runner-registry.mjs';
import { createSessionManager } from '../src/execution/session-manager.mjs';
import { createLocalWorkspaceProvider, createWorkspaceManager } from '../src/execution/workspace-manager.mjs';
import { createTaskExecutor } from '../src/execution/task-executor.mjs';
import { createLockManager } from '../src/control-plane/locks.mjs';
import { createEventStore } from '../src/evidence/event-store.mjs';
import { createArtifactRegistry, hashContent } from '../src/evidence/artifact-registry.mjs';
import { createTraceRegistry } from '../src/evidence/trace-registry.mjs';
import { createGitIntegrationService } from '../src/integration/git-integration-service.mjs';
import { createReleaseService } from '../src/release/release-service.mjs';
import { createMaintenanceWorkflowSeed, routeMaintenanceItem } from '../src/maintenance/maintenance-router.mjs';
import { createOsRuntime } from '../src/system/os-runtime.mjs';

const inputHash = `sha256:${'6'.repeat(64)}`;
const fileHash = `sha256:${'7'.repeat(64)}`;
const baseCommit = 'basecommit1234567';
const integrationCommit = 'integrationcommit1234567';
const registeredGates = ['DESIGN_GATE', 'TEST_GATE', 'PRODUCT_ACCEPTANCE_GATE', 'USER_ACCEPTANCE_GATE'];

function createClock() {
  let value = Date.parse('2026-07-14T00:10:00.000Z');
  return () => new Date(value += 1_000).toISOString();
}

function createSyntheticRunner(calls) {
  return Object.freeze({
    runnerId: 'synthetic-runner',
    runnerType: 'SYNTHETIC',
    capabilities: Object.freeze(['AGENT', 'CODE_EDIT', 'SELF_TEST']),
    async execute(request) {
      calls.push(request.task.taskId);
      return Object.freeze({
        executionId: request.executionId,
        status: 'SUCCEEDED',
        exitCode: 0,
        stdout: `completed ${request.task.taskId}`,
        stderr: '',
        parsedOutput: Object.freeze({
          changedFiles: Object.freeze([`${request.task.editablePaths[0].replace('/**', '')}/index.mjs`]),
          implementedRequirementIds: Object.freeze([...request.task.requirementIds]),
          artifactIds: Object.freeze([]),
          testsRun: Object.freeze([]),
          issueIds: Object.freeze([]),
          knownRisks: Object.freeze([]),
          sourceCommit: `${request.task.taskId}-commit1234567`,
        }),
      });
    },
  });
}

function createAgentContract() {
  return Object.freeze({
    schemaVersion: '1.0',
    entityType: 'AGENT_CONTRACT',
    agentId: 'developer-agent',
    role: 'Developer',
    capabilities: Object.freeze(['CODE_EDIT', 'SELF_TEST']),
    allowedTools: Object.freeze(['shell']),
    editablePaths: Object.freeze(['src/**']),
    forbiddenPaths: Object.freeze(['src/secrets/**']),
    outputSchemaId: 'https://moreagent.dev/schemas/execution.schema.json#/$defs/agentResult',
  });
}

function createTask({ taskId, contextManifestId, editablePath, dependsOn = [], consumes = [], produces = [] }) {
  return Object.freeze({
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId,
    workflowId: 'workflow-synthetic',
    workstreamId: `workstream-${taskId}`,
    ownerAgent: 'developer-agent',
    goal: `Implement ${taskId}`,
    requirementIds: Object.freeze(['REQ-SYNTHETIC-001']),
    inputHash,
    dependsOn: Object.freeze(dependsOn),
    softDependsOn: Object.freeze([]),
    conflictsWith: Object.freeze([]),
    resourceLocks: Object.freeze([`module:${taskId}`]),
    consumes: Object.freeze(consumes),
    produces: Object.freeze(produces),
    editablePaths: Object.freeze([editablePath]),
    forbiddenPaths: Object.freeze(['src/secrets/**']),
    acceptanceCommands: Object.freeze(['node --test']),
    requiredTests: Object.freeze(['unit', 'integration']),
    contextManifestId,
    status: 'READY',
    attempt: 0,
    maxAttempts: 2,
  });
}

function passingGate(runtime, { gateId, gateType, phase, inputArtifactIds = [], userConfirmation = null }) {
  return runtime.evaluateGate({
    gateId,
    gateType,
    workflowId: 'workflow-synthetic',
    phase,
    inputArtifactIds,
    deterministicChecks: [
      { checkId: `${gateId}-contract`, status: 'PASS', reason: null, evidenceIds: [] },
      { checkId: `${gateId}-quality`, status: 'PASS', reason: null, evidenceIds: inputArtifactIds },
    ],
    issues: [],
    reviewerRecommendations: [
      { reviewer: 'independent-reviewer', conclusion: 'APPROVED', note: 'Synthetic evidence is complete.' },
    ],
    requiresUserConfirmation: Boolean(userConfirmation),
    userConfirmation,
  });
}

test('synthetic project completes the AI Software Company OS lifecycle through maintenance', async () => {
  const now = createClock();
  const schemaRegistry = await createSchemaRegistry();
  const runnerCalls = [];
  const runnerRegistry = createRunnerRegistry([createSyntheticRunner(runnerCalls)]);
  const sessionManager = createSessionManager({ now, staleAfterMs: 30_000 });
  const workspaceManager = createWorkspaceManager({
    now,
    providers: [createLocalWorkspaceProvider({ rootPath: process.cwd() })],
  });
  const lockManager = createLockManager({ now: () => Date.parse(now()) });
  const eventStore = createEventStore();
  const artifactRegistry = createArtifactRegistry({ now });
  const traceRegistry = createTraceRegistry({ now });
  const taskExecutor = createTaskExecutor({
    runnerRegistry,
    sessionManager,
    workspaceManager,
    lockManager,
    now,
    heartbeatIntervalMs: 50,
    leaseMs: 500,
    validateAgentResult: (result) => schemaRegistry.assert('https://moreagent.dev/schemas/execution.schema.json', result),
  });

  const integrationService = createGitIntegrationService({
    now,
    runGit({ args }) {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: integrationCommit, stderr: '' };
      if (args[0] === 'diff' && args.includes('--name-only') && !args.includes('--diff-filter=U')) {
        return { exitCode: 0, stdout: 'src/backend/index.mjs\nsrc/frontend/index.mjs\nsrc/integration/index.mjs', stderr: '' };
      }
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    async runCommand() {
      return { exitCode: 0, stdout: 'verification passed', stderr: '' };
    },
  });

  const releaseService = createReleaseService({
    now,
    async runCommand() {
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });

  const runtime = createOsRuntime({
    schemaRegistry,
    taskExecutor,
    eventStore,
    artifactRegistry,
    traceRegistry,
    integrationService,
    releaseService,
    registeredGates,
    now,
  });

  runtime.registerProject({
    schemaVersion: '1.0',
    entityType: 'PROJECT',
    projectId: 'project-synthetic',
    name: 'Synthetic Delivery Project',
    projectType: 'NEW_PROJECT',
    repository: { provider: 'LOCAL', owner: 'synthetic', name: 'synthetic-project' },
    defaultBranch: 'main',
    profileId: 'profile-synthetic',
    constraints: { realBusinessData: false },
    createdAt: now(),
    updatedAt: now(),
  });

  runtime.createWorkflow({
    schemaVersion: '1.0',
    entityType: 'WORKFLOW',
    workflowId: 'workflow-synthetic',
    projectId: 'project-synthetic',
    goal: 'Deliver a synthetic full-stack slice through maintenance',
    phase: 'INTAKE',
    status: 'READY',
    round: 0,
    iteration: 0,
    inputHash,
    requirementIds: ['REQ-SYNTHETIC-001'],
    activeTaskIds: [],
    openIssueIds: [],
    currentGateId: null,
    createdAt: now(),
    updatedAt: now(),
  });

  runtime.transition('workflow-synthetic', { toPhase: 'PRODUCT_DESIGN', toStatus: 'RUNNING', reason: 'intake clarified' });
  runtime.transition('workflow-synthetic', { toPhase: 'MULTI_ROLE_REVIEW', toStatus: 'RUNNING', reason: 'product design ready' });
  runtime.transition('workflow-synthetic', { toPhase: 'TECHNICAL_DESIGN', toStatus: 'RUNNING', reason: 'multi-role review approved' });
  runtime.transition('workflow-synthetic', { toPhase: 'TASK_PLANNING', toStatus: 'RUNNING', reason: 'technical design approved' });

  const designArtifact = runtime.registerArtifact({
    projectId: 'project-synthetic',
    workflowId: 'workflow-synthetic',
    logicalKey: 'design/synthetic-slice',
    artifactType: 'DEVELOPMENT_DESIGN',
    content: { requirementId: 'REQ-SYNTHETIC-001', modules: ['backend', 'frontend', 'integration'] },
    location: 'artifacts/design/synthetic-slice.json',
    producedBy: 'architecture-agent',
    phase: 'TASK_PLANNING',
    sourceCommit: baseCommit,
    inputHash,
  });

  const projectMap = runtime.registerProjectMap({
    projectId: 'project-synthetic',
    baseCommit,
    modules: [
      { id: 'backend', path: 'src/backend' },
      { id: 'frontend', path: 'src/frontend' },
      { id: 'integration', path: 'src/integration' },
    ],
  });

  const backendContext = traceRegistry.createContextManifest({
    taskId: 'backend-task', inputHash, projectMapId: projectMap.projectMapId,
    files: [{ path: 'src/backend/index.mjs', hash: fileHash }],
    artifactIds: [designArtifact.artifactId], editablePaths: ['src/backend/**'], forbiddenPaths: ['src/secrets/**'], tokenBudget: 20_000,
  });
  const frontendContext = traceRegistry.createContextManifest({
    taskId: 'frontend-task', inputHash, projectMapId: projectMap.projectMapId,
    files: [{ path: 'src/frontend/index.mjs', hash: fileHash }],
    artifactIds: [designArtifact.artifactId], editablePaths: ['src/frontend/**'], forbiddenPaths: ['src/secrets/**'], tokenBudget: 20_000,
  });
  const integrationContext = traceRegistry.createContextManifest({
    taskId: 'integration-task', inputHash, projectMapId: projectMap.projectMapId,
    files: [{ path: 'src/integration/index.mjs', hash: fileHash }],
    artifactIds: [designArtifact.artifactId], editablePaths: ['src/integration/**'], forbiddenPaths: ['src/secrets/**'], tokenBudget: 20_000,
  });

  const tasks = [
    createTask({ taskId: 'backend-task', contextManifestId: backendContext.contextManifestId, editablePath: 'src/backend/**', produces: ['artifact-backend'] }),
    createTask({ taskId: 'frontend-task', contextManifestId: frontendContext.contextManifestId, editablePath: 'src/frontend/**', produces: ['artifact-frontend'] }),
    createTask({
      taskId: 'integration-task', contextManifestId: integrationContext.contextManifestId, editablePath: 'src/integration/**',
      dependsOn: ['backend-task', 'frontend-task'], consumes: ['artifact-backend', 'artifact-frontend'], produces: ['artifact-integrated'],
    }),
  ];
  const dag = runtime.addTasks('workflow-synthetic', tasks);
  assert.deepEqual(dag.levels, [['backend-task', 'frontend-task'], ['integration-task']]);

  const designGate = passingGate(runtime, {
    gateId: 'design-gate-synthetic', gateType: 'DESIGN_GATE', phase: 'TASK_PLANNING', inputArtifactIds: [designArtifact.artifactId],
  });
  assert.equal(designGate.conclusion, 'APPROVED');
  runtime.applyApprovedGate('workflow-synthetic', designGate.gateId, {
    toPhase: 'IMPLEMENTATION', toStatus: 'RUNNING', reason: 'design gate approved',
  });

  const executionOptions = Object.fromEntries(tasks.map((task) => [task.taskId, {
    agentContract: createAgentContract(),
    runnerId: 'synthetic-runner',
    workspaceProviderId: 'local',
    projectId: 'project-synthetic',
    baseCommit,
    requestedTools: ['shell'],
    requestedPaths: [task.editablePaths[0].replace('/**', '/index.mjs')],
    policy: { autoEnabled: false },
  }]));

  const firstSchedule = runtime.schedule('workflow-synthetic', { maxConcurrent: 2 });
  assert.deepEqual(firstSchedule.assignments.map((assignment) => assignment.taskId), ['backend-task', 'frontend-task']);
  const firstResults = await runtime.executeAssignments('workflow-synthetic', firstSchedule.assignments, executionOptions);
  assert.ok(firstResults.every((result) => result.run.status === 'SUCCEEDED'));

  const secondSchedule = runtime.schedule('workflow-synthetic', { maxConcurrent: 2 });
  assert.deepEqual(secondSchedule.assignments.map((assignment) => assignment.taskId), ['integration-task']);
  const secondResults = await runtime.executeAssignments('workflow-synthetic', secondSchedule.assignments, executionOptions);
  assert.equal(secondResults[0].run.status, 'SUCCEEDED');
  assert.deepEqual(runnerCalls.sort(), ['backend-task', 'frontend-task', 'integration-task']);
  assert.equal(lockManager.snapshot().length, 0);

  runtime.transition('workflow-synthetic', { toPhase: 'REVIEW', toStatus: 'RUNNING', reason: 'implementation completed' });
  runtime.transition('workflow-synthetic', { toPhase: 'INTEGRATION', toStatus: 'RUNNING', reason: 'independent review approved' });

  const taskCommits = [...firstResults, ...secondResults].map((result) => result.agentResult.sourceCommit);
  const integration = await runtime.integrate('workflow-synthetic', {
    projectId: 'project-synthetic',
    projectRoot: '/synthetic-project',
    baseCommit,
    taskCommits,
    integrationBranch: 'integration/workflow-synthetic',
    integrationWorktreePath: '/synthetic-project/.worktrees/integration',
    verificationCommands: [{ verificationId: 'synthetic-tests', command: 'node', args: ['--test'] }],
    requirementIds: ['REQ-SYNTHETIC-001'],
    cleanupWorktree: true,
  });
  assert.equal(integration.passed, true);
  assert.equal(integration.evidence.integrationCommit, integrationCommit);

  const integrationArtifact = runtime.registerArtifact({
    projectId: 'project-synthetic', workflowId: 'workflow-synthetic', logicalKey: 'integration/final', artifactType: 'INTEGRATION_EVIDENCE',
    content: integration.evidence, location: 'artifacts/integration/final.json', producedBy: 'integration-service', phase: 'INTEGRATION',
    sourceCommit: integrationCommit, inputHash,
  });

  runtime.transition('workflow-synthetic', { toPhase: 'SYSTEM_TEST', toStatus: 'RUNNING', reason: 'integration commit created' });
  const testGate = passingGate(runtime, {
    gateId: 'test-gate-synthetic', gateType: 'TEST_GATE', phase: 'SYSTEM_TEST', inputArtifactIds: [integrationArtifact.artifactId],
  });
  runtime.applyApprovedGate('workflow-synthetic', testGate.gateId, {
    toPhase: 'PRODUCT_ACCEPTANCE', toStatus: 'RUNNING', reason: 'system test approved integration commit',
  });

  const productAcceptance = runtime.recordAcceptance({
    schemaVersion: '1.0', entityType: 'ACCEPTANCE', acceptanceId: 'acceptance-product-synthetic', workflowId: 'workflow-synthetic',
    acceptanceType: 'PRODUCT', status: 'APPROVED', requirementIds: ['REQ-SYNTHETIC-001'], evidenceIds: [integrationArtifact.artifactId],
    decidedBy: 'product-agent', decidedAt: now(), baselineHash: hashContent(integration.evidence), baselineCommit: integrationCommit, feedback: null,
  });
  const productGate = passingGate(runtime, {
    gateId: 'product-gate-synthetic', gateType: 'PRODUCT_ACCEPTANCE_GATE', phase: 'PRODUCT_ACCEPTANCE',
    inputArtifactIds: [integrationArtifact.artifactId], userConfirmation: productAcceptance,
  });
  runtime.applyApprovedGate('workflow-synthetic', productGate.gateId, {
    toPhase: 'USER_ACCEPTANCE', toStatus: 'RUNNING', reason: 'product acceptance approved',
  });

  const userAcceptance = runtime.recordAcceptance({
    schemaVersion: '1.0', entityType: 'ACCEPTANCE', acceptanceId: 'acceptance-user-synthetic', workflowId: 'workflow-synthetic',
    acceptanceType: 'USER', status: 'APPROVED', requirementIds: ['REQ-SYNTHETIC-001'], evidenceIds: [integrationArtifact.artifactId],
    decidedBy: 'synthetic-user', decidedAt: now(), baselineHash: hashContent(integration.evidence), baselineCommit: integrationCommit, feedback: null,
  });
  const userGate = passingGate(runtime, {
    gateId: 'user-gate-synthetic', gateType: 'USER_ACCEPTANCE_GATE', phase: 'USER_ACCEPTANCE',
    inputArtifactIds: [integrationArtifact.artifactId], userConfirmation: userAcceptance,
  });
  runtime.applyApprovedGate('workflow-synthetic', userGate.gateId, {
    toPhase: 'RELEASE', toStatus: 'RUNNING', reason: 'user acceptance approved',
  });

  const release = await runtime.release('workflow-synthetic', {
    releaseId: 'release-synthetic', projectId: 'project-synthetic', integrationCommit, targetEnvironment: 'synthetic',
    userAcceptanceId: userAcceptance.acceptanceId,
    migrationCommands: [{ verificationId: 'migration-dry-run', command: 'synthetic-migrate' }],
    releaseCommands: [{ verificationId: 'release-command', command: 'synthetic-release' }],
    healthChecks: [{ verificationId: 'health-check', command: 'synthetic-health' }],
    rollbackCommands: [{ verificationId: 'rollback-command', command: 'synthetic-rollback' }],
    rollbackPlan: 'Execute synthetic rollback command and verify health.',
  });
  assert.equal(release.status, 'RELEASED');
  runtime.transition('workflow-synthetic', { toPhase: 'MAINTENANCE', toStatus: 'RUNNING', reason: 'release health checks passed' });

  const maintenanceItem = routeMaintenanceItem({
    itemId: 'maintenance-synthetic', itemType: 'dependency update', projectId: 'project-synthetic', workflowId: 'workflow-synthetic',
    summary: 'Apply a synthetic dependency update',
    evidence: { 'advisory-or-release-notes': 'synthetic notes', 'compatibility-impact': 'no breaking change' },
    createdAt: now(),
  });
  const maintenanceSeed = createMaintenanceWorkflowSeed(maintenanceItem);
  assert.equal(maintenanceSeed.initialPhase, 'IMPLEMENTATION');

  const trace = runtime.upsertRequirementTrace({
    projectId: 'project-synthetic', workflowId: 'workflow-synthetic', requirementId: 'REQ-SYNTHETIC-001',
    links: {
      designArtifactIds: [designArtifact.artifactId],
      taskIds: tasks.map((task) => task.taskId),
      commitShas: [...taskCommits, integrationCommit],
      testEvidenceIds: [integrationArtifact.artifactId],
      gateIds: [designGate.gateId, testGate.gateId, productGate.gateId, userGate.gateId],
      acceptanceIds: [productAcceptance.acceptanceId, userAcceptance.acceptanceId],
    },
  });
  assert.equal(traceRegistry.assessTraceCompleteness({
    projectId: 'project-synthetic', workflowId: 'workflow-synthetic', requirementIds: ['REQ-SYNTHETIC-001'],
  }).complete, true);
  assert.equal(schemaRegistry.validate('https://moreagent.dev/schemas/evidence.schema.json', trace).valid, true);

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.workflows[0].phase, 'MAINTENANCE');
  assert.ok(snapshot.tasks.every((task) => task.status === 'APPROVED'));
  assert.equal(snapshot.releases[0].status, 'RELEASED');
  assert.equal(new Set(snapshot.events.map((event) => event.idempotencyKey)).size, snapshot.events.length);
  assert.ok(snapshot.events.some((event) => event.eventType === 'integration.completed'));
  assert.ok(snapshot.events.some((event) => event.eventType === 'release.completed'));
  assert.equal(Object.isFrozen(runtime.getWorkflow('workflow-synthetic')), true);
  assert.throws(() => { runtime.getWorkflow('workflow-synthetic').phase = 'IMPLEMENTATION'; }, TypeError);
});
