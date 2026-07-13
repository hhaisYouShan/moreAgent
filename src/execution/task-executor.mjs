import { AttemptStatus, AttemptType, RunStatus } from '../domain/enums.mjs';
import { assertTaskPolicy } from '../control-plane/policy-engine.mjs';
import { executionKey } from '../control-plane/dag.mjs';

export function createTaskExecutor({
  runnerRegistry,
  sessionManager,
  workspaceManager,
  lockManager,
  validateAgentResult = null,
  now = () => new Date().toISOString(),
  heartbeatIntervalMs = 10_000,
  leaseMs = 30_000,
  onEvent = null,
} = {}) {
  if (!runnerRegistry?.require) throw new TypeError('runnerRegistry is required');
  if (!sessionManager?.create) throw new TypeError('sessionManager is required');
  if (!workspaceManager?.create) throw new TypeError('workspaceManager is required');
  if (!lockManager?.acquire) throw new TypeError('lockManager is required');
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1) throw new TypeError('heartbeatIntervalMs must be positive');
  if (!Number.isInteger(leaseMs) || leaseMs < heartbeatIntervalMs) throw new TypeError('leaseMs must be >= heartbeatIntervalMs');

  let sequence = 0;

  return Object.freeze({
    async execute({
      task,
      agentContract,
      runnerId,
      workspaceProviderId,
      projectId,
      baseCommit,
      context = {},
      requestedTools = [],
      requestedPaths = task?.editablePaths || [],
      executionMode = 'single',
      policy = {},
      budgetUsage = {},
      timeoutMs = task?.timeoutSeconds ? task.timeoutSeconds * 1_000 : 0,
      signal = null,
      env = {},
      prompt = null,
      reuseSessionId = null,
      retainWorkspaceOnFailure = true,
      closeSession = false,
    } = {}) {
      for (const [name, value] of Object.entries({ task, agentContract, runnerId, workspaceProviderId, projectId, baseCommit })) {
        if (!value) throw new TypeError(`${name} is required`);
      }

      assertTaskPolicy({ task, agentContract, requestedTools, requestedPaths, budgetUsage, executionMode, policy });
      const runner = runnerRegistry.require(runnerId);
      const attemptNumber = Number(task.attempt || 0) + 1;
      const attemptType = task.attemptType || (attemptNumber === 1 ? AttemptType.INITIAL : AttemptType.REPAIR);
      const attemptId = `attempt-${task.taskId}-${attemptNumber}`;
      const runId = `run-${task.taskId}-${++sequence}`;
      const ownerId = attemptId;
      const key = executionKey(task, executionMode);
      const startedAt = timestamp();

      const lockResult = lockManager.acquire({
        resources: task.resourceLocks?.length ? task.resourceLocks : [`task:${task.taskId}`],
        ownerId,
        leaseMs,
        metadata: { taskId: task.taskId, runId, attemptId },
      });
      if (!lockResult.acquired) {
        return frozenFailure({
          task,
          runId,
          attemptId,
          attemptNumber,
          attemptType,
          startedAt,
          status: RunStatus.FAILED,
          failureReason: 'lock_conflict',
          details: lockResult.conflicts,
        });
      }

      let workspace = null;
      let session = null;
      let heartbeat = null;
      let runnerResult = null;
      let executionError = null;
      let validationError = null;
      const cleanupErrors = [];

      try {
        workspace = await workspaceManager.create({
          providerId: workspaceProviderId,
          projectId,
          taskId: task.taskId,
          baseCommit,
          branch: `agent/task/${sanitize(task.taskId)}`,
          metadata: { runId, attemptId },
        });
        workspace = workspaceManager.markInUse(workspace.workspaceId);

        session = reuseSessionId
          ? sessionManager.resume(reuseSessionId)
          : sessionManager.create({ agentId: agentContract.agentId, runnerId, metadata: { taskId: task.taskId, runId, attemptId } });

        emit('task.execution_started', { taskId: task.taskId, runId, attemptId, sessionId: session.sessionId, workspaceId: workspace.workspaceId });
        heartbeat = setInterval(() => {
          try {
            sessionManager.heartbeat(session.sessionId);
            lockManager.heartbeat({ ownerId, leaseMs });
            emit('task.execution_heartbeat', { taskId: task.taskId, runId, attemptId, sessionId: session.sessionId });
          } catch (error) {
            emit('task.execution_heartbeat_failed', { taskId: task.taskId, runId, attemptId, error: error.message });
          }
        }, heartbeatIntervalMs);
        heartbeat.unref?.();

        runnerResult = await runner.execute({
          executionId: runId,
          task,
          agentId: agentContract.agentId,
          sessionId: session.externalSessionId || null,
          workspace,
          context,
          prompt,
          env,
          timeoutMs,
          signal,
          onOutput: (output) => emit('task.execution_output', { taskId: task.taskId, runId, stream: output.stream, bytes: Buffer.byteLength(output.text || '') }),
        });
      } catch (error) {
        executionError = error;
      } finally {
        clearInterval(heartbeat);
      }

      const finishedAt = timestamp();
      let normalized = normalizeRunnerResult(runnerResult, executionError);
      const agentResult = Object.freeze({
        schemaVersion: '1.0',
        entityType: 'AGENT_RESULT',
        resultId: `result-${runId}`,
        taskId: task.taskId,
        runId,
        sessionId: session?.sessionId || `session-unavailable-${runId}`,
        agentId: agentContract.agentId,
        conclusion: normalized.agentConclusion,
        changedFiles: Object.freeze([...(runnerResult?.parsedOutput?.changedFiles || [])]),
        implementedRequirementIds: Object.freeze([...(runnerResult?.parsedOutput?.implementedRequirementIds || [])]),
        artifactIds: Object.freeze([...(runnerResult?.parsedOutput?.artifactIds || [])]),
        testsRun: Object.freeze([...(runnerResult?.parsedOutput?.testsRun || [])]),
        issues: Object.freeze([...(runnerResult?.parsedOutput?.issueIds || [])]),
        knownRisks: Object.freeze([...(runnerResult?.parsedOutput?.knownRisks || [])]),
        ...(runnerResult?.parsedOutput?.sourceCommit ? { sourceCommit: runnerResult.parsedOutput.sourceCommit } : {}),
        startedAt,
        finishedAt,
      });

      try {
        if (typeof validateAgentResult === 'function') await validateAgentResult(agentResult);
      } catch (error) {
        validationError = error;
        normalized = {
          runStatus: RunStatus.FAILED,
          attemptStatus: AttemptStatus.FAILED,
          agentConclusion: 'FAILED',
          failureReason: 'output_contract_error',
        };
        emit('task.execution_output_invalid', { taskId: task.taskId, runId, attemptId, error: error.message });
      }

      const shouldRetainWorkspace = normalized.runStatus !== RunStatus.SUCCEEDED && retainWorkspaceOnFailure;
      try {
        if (session) {
          if (closeSession) sessionManager.close(session.sessionId);
          else sessionManager.markIdle(session.sessionId);
        }
      } catch (error) {
        cleanupErrors.push({ resource: 'session', error: error.message });
      }
      try {
        if (workspace && !shouldRetainWorkspace) await workspaceManager.release(workspace.workspaceId);
        else if (workspace && shouldRetainWorkspace) workspaceManager.markStale(workspace.workspaceId, normalized.failureReason || 'execution_failed');
      } catch (error) {
        cleanupErrors.push({ resource: 'workspace', error: error.message });
      } finally {
        try {
          lockManager.release({ ownerId });
        } catch (error) {
          cleanupErrors.push({ resource: 'lock', error: error.message });
        }
      }

      if (cleanupErrors.length && normalized.runStatus === RunStatus.SUCCEEDED) {
        normalized = {
          runStatus: RunStatus.FAILED,
          attemptStatus: AttemptStatus.FAILED,
          agentConclusion: 'FAILED',
          failureReason: 'cleanup_failed',
        };
      }

      const result = Object.freeze({
        taskId: task.taskId,
        attempt: Object.freeze({
          schemaVersion: '1.0',
          entityType: 'ATTEMPT',
          attemptId,
          taskId: task.taskId,
          workstreamId: task.workstreamId,
          runId,
          attemptNumber,
          attemptType,
          status: normalized.attemptStatus,
          inputHash: task.inputHash,
          issueIds: agentResult.issues,
          startedAt,
          finishedAt,
        }),
        run: Object.freeze({
          schemaVersion: '1.0',
          entityType: 'RUN',
          runId,
          taskId: task.taskId,
          attempt: attemptNumber,
          executionKey: key,
          status: normalized.runStatus,
          sessionId: session?.sessionId || null,
          workspaceId: workspace?.workspaceId || null,
          startedAt,
          finishedAt,
          exitCode: runnerResult?.exitCode ?? null,
        }),
        agentResult,
        runnerResult,
        workspaceRetained: shouldRetainWorkspace,
        failureReason: normalized.failureReason,
        validationError: validationError ? serializeError(validationError) : null,
        cleanupErrors: Object.freeze(cleanupErrors.map((item) => Object.freeze(item))),
      });

      emit('task.execution_finished', { taskId: task.taskId, runId, attemptId, status: normalized.runStatus, failureReason: normalized.failureReason });
      return result;
    },
  });

  function emit(eventType, payload) {
    onEvent?.(Object.freeze({ eventType, occurredAt: timestamp(), payload: Object.freeze({ ...payload }) }));
  }

  function timestamp() {
    const value = now();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
    return date.toISOString();
  }
}

function normalizeRunnerResult(result, error) {
  if (error) return { runStatus: RunStatus.FAILED, attemptStatus: AttemptStatus.FAILED, agentConclusion: 'FAILED', failureReason: error.message || String(error) };
  switch (result?.status) {
    case 'SUCCEEDED':
      return { runStatus: RunStatus.SUCCEEDED, attemptStatus: AttemptStatus.SUCCEEDED, agentConclusion: 'SUCCEEDED', failureReason: null };
    case 'CANCELLED':
      return { runStatus: RunStatus.CANCELLED, attemptStatus: AttemptStatus.CANCELLED, agentConclusion: 'CANCELLED', failureReason: 'cancelled' };
    case 'TIMED_OUT':
      return { runStatus: RunStatus.TIMED_OUT, attemptStatus: AttemptStatus.TIMED_OUT, agentConclusion: 'FAILED', failureReason: 'timeout' };
    default:
      return { runStatus: RunStatus.FAILED, attemptStatus: AttemptStatus.FAILED, agentConclusion: 'FAILED', failureReason: result?.error || result?.stderr || 'runner_failed' };
  }
}

function frozenFailure({ task, runId, attemptId, attemptNumber, attemptType, startedAt, status, failureReason, details }) {
  return Object.freeze({
    taskId: task.taskId,
    attempt: Object.freeze({
      schemaVersion: '1.0',
      entityType: 'ATTEMPT',
      attemptId,
      taskId: task.taskId,
      workstreamId: task.workstreamId,
      runId,
      attemptNumber,
      attemptType,
      status: AttemptStatus.BLOCKED,
      inputHash: task.inputHash,
      issueIds: Object.freeze([]),
      startedAt,
      finishedAt: startedAt,
    }),
    run: Object.freeze({
      schemaVersion: '1.0',
      entityType: 'RUN',
      runId,
      taskId: task.taskId,
      attempt: attemptNumber,
      executionKey: executionKey(task),
      status,
      sessionId: null,
      workspaceId: null,
      startedAt,
      finishedAt: startedAt,
      exitCode: null,
    }),
    agentResult: null,
    runnerResult: null,
    workspaceRetained: false,
    failureReason,
    details,
    validationError: null,
    cleanupErrors: Object.freeze([]),
  });
}

function serializeError(error) {
  return Object.freeze({
    name: error?.name || 'Error',
    code: error?.code || null,
    message: error?.message || String(error),
  });
}

function sanitize(value) {
  return String(value || 'task').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
}
