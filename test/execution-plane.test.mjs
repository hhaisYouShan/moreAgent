import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRunnerRegistry } from '../src/execution/runner-registry.mjs';
import { createLocalProcessRunner } from '../src/execution/local-process-runner.mjs';
import { createSessionManager } from '../src/execution/session-manager.mjs';
import { createLocalWorkspaceProvider, createWorkspaceManager } from '../src/execution/workspace-manager.mjs';
import { createTaskExecutor } from '../src/execution/task-executor.mjs';
import { createLockManager } from '../src/control-plane/locks.mjs';
import { createSchemaRegistry } from '../src/contracts/schema-registry.mjs';
import { createOpenCodeRunner } from '../adapters/runners/opencode.mjs';
import { createCodexRunner } from '../adapters/runners/codex.mjs';
import { createGitWorktreeProvider } from '../adapters/workspaces/git-worktree.mjs';

const hash = `sha256:${'3'.repeat(64)}`;
const executionSchema = 'https://moreagent.dev/schemas/execution.schema.json';
const workSchema = 'https://moreagent.dev/schemas/work.schema.json';

function task(overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'TASK',
    taskId: 'task-demo',
    workflowId: 'workflow-demo',
    workstreamId: 'workstream-demo',
    ownerAgent: 'developer-agent',
    goal: 'Deliver one atomic change',
    requirementIds: ['REQ-1'],
    inputHash: hash,
    dependsOn: [],
    softDependsOn: [],
    conflictsWith: [],
    resourceLocks: ['path:src/demo'],
    consumes: [],
    produces: [],
    editablePaths: ['src/demo/**'],
    forbiddenPaths: ['src/demo/secrets/**'],
    acceptanceCommands: ['node --test'],
    requiredTests: ['unit'],
    contextManifestId: 'context-demo',
    status: 'READY',
    attempt: 0,
    maxAttempts: 2,
    ...overrides,
  };
}

function agentContract(overrides = {}) {
  return {
    schemaVersion: '1.0',
    entityType: 'AGENT_CONTRACT',
    agentId: 'developer-agent',
    role: 'Developer',
    capabilities: ['CODE_EDIT'],
    allowedTools: ['shell'],
    editablePaths: ['src/demo/**'],
    forbiddenPaths: ['src/demo/secrets/**'],
    outputSchemaId: `${executionSchema}#/$defs/agentResult`,
    ...overrides,
  };
}

function fakeRunner(runnerId, calls, parsedOutput = {}) {
  return Object.freeze({
    runnerId,
    runnerType: 'FAKE',
    capabilities: Object.freeze(['AGENT', 'CODE_EDIT']),
    async execute(request) {
      calls.push({ runnerId, request });
      return Object.freeze({
        executionId: request.executionId,
        status: 'SUCCEEDED',
        exitCode: 0,
        stdout: runnerId,
        stderr: '',
        parsedOutput: {
          changedFiles: ['src/demo/index.mjs'],
          implementedRequirementIds: ['REQ-1'],
          artifactIds: [],
          testsRun: [],
          issueIds: [],
          knownRisks: [],
          sourceCommit: 'abcdef1234567',
          ...parsedOutput,
        },
      });
    },
  });
}

test('runner registry selects replaceable runners without changing Task contracts', () => {
  const registry = createRunnerRegistry([
    fakeRunner('runner-b', []),
    fakeRunner('runner-a', []),
  ]);
  assert.equal(registry.select({ capabilities: ['CODE_EDIT'] }).runnerId, 'runner-a');
  assert.equal(registry.require('runner-b').runnerId, 'runner-b');
  assert.throws(() => registry.select({ capabilities: ['DATABASE_ADMIN'] }), (error) => error.code === 'RUNNER_CAPABILITY_UNAVAILABLE');
});

test('local process runner captures output, timeout and explicit cancellation', async () => {
  const runner = createLocalProcessRunner({ killGraceMs: 20 });
  const success = await runner.execute({
    executionId: 'process-success',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    timeoutMs: 1_000,
  });
  assert.equal(success.status, 'SUCCEEDED');
  assert.equal(success.stdout, 'ok');

  const timeout = await runner.execute({
    executionId: 'process-timeout',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    timeoutMs: 30,
  });
  assert.equal(timeout.status, 'TIMED_OUT');

  const cancellationPromise = runner.execute({
    executionId: 'process-cancel',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    timeoutMs: 1_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runner.cancel('process-cancel'), true);
  const cancelled = await cancellationPromise;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(runner.activeExecutions().length, 0);
});

test('Session and Workspace managers expose contract-valid lifecycle snapshots', async () => {
  let clock = Date.parse('2026-07-13T17:00:00.000Z');
  const now = () => new Date(clock).toISOString();
  const sessions = createSessionManager({ now, staleAfterMs: 100 });
  const session = sessions.create({ agentId: 'developer-agent', runnerId: 'fake' });
  clock += 101;
  assert.equal(sessions.reapStale()[0].status, 'STALE');
  assert.equal(sessions.resume(session.sessionId).status, 'ACTIVE');
  assert.equal(sessions.close(session.sessionId).status, 'CLOSED');

  const released = [];
  const workspaces = createWorkspaceManager({
    now,
    providers: [{
      providerId: 'memory',
      workspaceType: 'LOCAL',
      async create({ workspaceId }) {
        return { path: `/tmp/${workspaceId}`, branch: null };
      },
      async release({ workspace }) {
        released.push(workspace.workspaceId);
      },
    }],
  });
  const workspace = await workspaces.create({ providerId: 'memory', projectId: 'project-demo', taskId: 'task-demo', baseCommit: 'abcdef1234567' });
  assert.equal(workspaces.markInUse(workspace.workspaceId).status, 'IN_USE');
  const finalWorkspace = await workspaces.release(workspace.workspaceId);
  assert.equal(finalWorkspace.status, 'RELEASED');
  assert.deepEqual(released, [workspace.workspaceId]);

  const schemas = await createSchemaRegistry();
  assert.equal(schemas.validate(executionSchema, sessions.get(session.sessionId)).valid, true);
  assert.equal(schemas.validate(executionSchema, finalWorkspace).valid, true);
});

test('Task Executor can run the same Task through different Runner adapters', async () => {
  const calls = [];
  const runnerRegistry = createRunnerRegistry([fakeRunner('runner-a', calls), fakeRunner('runner-b', calls)]);
  const sessionManager = createSessionManager();
  const workspaceManager = createWorkspaceManager({ providers: [createLocalWorkspaceProvider({ rootPath: process.cwd() })] });
  const lockManager = createLockManager();
  const schemas = await createSchemaRegistry();
  const events = [];
  const executor = createTaskExecutor({
    runnerRegistry,
    sessionManager,
    workspaceManager,
    lockManager,
    validateAgentResult: (result) => schemas.assert(executionSchema, result),
    onEvent: (event) => events.push(event),
    heartbeatIntervalMs: 20,
    leaseMs: 100,
  });

  for (const runnerId of ['runner-a', 'runner-b']) {
    const result = await executor.execute({
      task: task(),
      agentContract: agentContract(),
      runnerId,
      workspaceProviderId: 'local',
      projectId: 'project-demo',
      baseCommit: 'abcdef1234567',
      requestedTools: ['shell'],
      requestedPaths: ['src/demo/index.mjs'],
      policy: { autoEnabled: false },
    });
    assert.equal(result.run.status, 'SUCCEEDED');
    assert.equal(result.agentResult.conclusion, 'SUCCEEDED');
    assert.equal(result.workspaceRetained, false);
    assert.equal(schemas.validate(executionSchema, result.run).valid, true);
    assert.equal(schemas.validate(workSchema, result.attempt).valid, true);
  }

  assert.deepEqual(calls.map((call) => call.runnerId), ['runner-a', 'runner-b']);
  assert.equal(lockManager.snapshot().length, 0);
  assert.ok(sessionManager.list().every((session) => session.status === 'IDLE'));
  assert.ok(workspaceManager.list().every((workspace) => workspace.status === 'RELEASED'));
  assert.ok(events.some((event) => event.eventType === 'task.execution_finished'));
});

test('Task Executor retains failed workspace but releases locks after output contract failure', async () => {
  const runnerRegistry = createRunnerRegistry([fakeRunner('invalid-output', [])]);
  const sessionManager = createSessionManager();
  const workspaceManager = createWorkspaceManager({ providers: [createLocalWorkspaceProvider({ rootPath: process.cwd() })] });
  const lockManager = createLockManager();
  const executor = createTaskExecutor({
    runnerRegistry,
    sessionManager,
    workspaceManager,
    lockManager,
    validateAgentResult() {
      const error = new Error('invalid output');
      error.code = 'OUTPUT_CONTRACT_ERROR';
      throw error;
    },
    heartbeatIntervalMs: 20,
    leaseMs: 100,
  });

  const result = await executor.execute({
    task: task(),
    agentContract: agentContract(),
    runnerId: 'invalid-output',
    workspaceProviderId: 'local',
    projectId: 'project-demo',
    baseCommit: 'abcdef1234567',
    requestedTools: ['shell'],
    requestedPaths: ['src/demo/index.mjs'],
    policy: { autoEnabled: false },
  });

  assert.equal(result.run.status, 'FAILED');
  assert.equal(result.failureReason, 'output_contract_error');
  assert.equal(result.workspaceRetained, true);
  assert.equal(result.validationError.code, 'OUTPUT_CONTRACT_ERROR');
  assert.equal(lockManager.snapshot().length, 0);
  assert.equal(workspaceManager.list()[0].status, 'STALE');
});

test('OpenCode and Codex adapters build profile-configurable process invocations', async () => {
  const calls = [];
  const processRunner = {
    async execute(request) {
      calls.push(request);
      return { status: 'SUCCEEDED', exitCode: 0, stdout: '', stderr: '' };
    },
    cancel() { return true; },
  };
  const openCode = createOpenCodeRunner({ processRunner, executable: 'opencode-custom', baseArgs: ['run'], promptTransport: 'STDIN' });
  const codex = createCodexRunner({ processRunner, executable: 'codex-custom', baseArgs: ['exec'], promptTransport: 'ARGUMENT' });

  await openCode.execute({ executionId: 'oc-1', task: task(), agentId: 'developer-agent', workspace: { path: '/tmp/work' }, prompt: 'do it' });
  await codex.execute({ executionId: 'cx-1', task: task(), workspace: { path: '/tmp/work' }, prompt: 'do it' });

  assert.equal(calls[0].command, 'opencode-custom');
  assert.equal(calls[0].stdin, 'do it');
  assert.equal(calls[1].command, 'codex-custom');
  assert.ok(calls[1].args.includes('do it'));
});

test('Git worktree provider creates and releases through injected Git commands', async () => {
  const calls = [];
  const provider = createGitWorktreeProvider({
    projectRoot: '/repo',
    worktreeRoot: '.worktrees',
    runGit({ cwd, args }) {
      calls.push({ cwd, args });
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });
  const created = await provider.create({ workspaceId: 'workspace-1', taskId: 'task-demo', baseCommit: 'abcdef1234567' });
  assert.equal(created.path, path.resolve('/repo', '.worktrees', 'workspace-1'));
  await provider.release({ workspace: { path: created.path }, force: true });
  assert.equal(calls[0].args[0], 'worktree');
  assert.ok(calls.some((call) => call.args.includes('prune')));
});
