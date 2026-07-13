export function createCommandRunnerAdapter({
  runnerId,
  runnerType = 'COMMAND_ADAPTER',
  capabilities = [],
  processRunner,
  buildInvocation,
} = {}) {
  if (!runnerId) throw new TypeError('runnerId is required');
  if (!processRunner?.execute) throw new TypeError('processRunner.execute is required');
  if (typeof buildInvocation !== 'function') throw new TypeError('buildInvocation must be a function');

  return Object.freeze({
    runnerId,
    runnerType,
    capabilities: Object.freeze([...new Set(['AGENT', ...capabilities])].sort()),

    async execute(request = {}) {
      const invocation = buildInvocation(request);
      if (!invocation?.command) throw new TypeError(`${runnerId} buildInvocation must return command`);
      const result = await processRunner.execute({
        executionId: request.executionId,
        command: invocation.command,
        args: invocation.args || [],
        cwd: invocation.cwd || request.workspace?.path || request.cwd,
        env: { ...(request.env || {}), ...(invocation.env || {}) },
        stdin: invocation.stdin ?? request.stdin ?? null,
        timeoutMs: request.timeoutMs || 0,
        signal: request.signal || null,
        onOutput: request.onOutput || null,
      });
      return Object.freeze({
        ...result,
        runnerId,
        invocation: Object.freeze({
          command: invocation.command,
          args: Object.freeze([...(invocation.args || [])]),
          cwd: invocation.cwd || request.workspace?.path || request.cwd || null,
        }),
        parsedOutput: typeof invocation.parseOutput === 'function'
          ? invocation.parseOutput(result)
          : null,
      });
    },

    cancel(executionId) {
      return processRunner.cancel?.(executionId) || false;
    },
  });
}

export function buildPromptInput({ task, context = {}, instructions = null }) {
  return JSON.stringify({
    task: {
      taskId: task?.taskId,
      goal: task?.goal,
      requirementIds: task?.requirementIds || [],
      editablePaths: task?.editablePaths || [],
      forbiddenPaths: task?.forbiddenPaths || [],
      acceptanceCommands: task?.acceptanceCommands || [],
      requiredTests: task?.requiredTests || [],
    },
    context,
    instructions,
  });
}
