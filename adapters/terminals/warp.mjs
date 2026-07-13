export function createWarpTerminalAdapter({
  processRunner,
  runnerId = 'warp',
  executable,
  buildArgs,
} = {}) {
  if (!processRunner?.execute) throw new TypeError('processRunner.execute is required');
  if (!executable) throw new TypeError('Warp adapter executable must be supplied by the Terminal Profile');
  if (typeof buildArgs !== 'function') throw new TypeError('Warp adapter buildArgs must be supplied by the Terminal Profile');

  return Object.freeze({
    runnerId,
    runnerType: 'WARP',
    capabilities: Object.freeze(['TERMINAL_SESSION', 'WINDOW', 'PROFILE_CONFIGURED']),

    execute(request = {}) {
      const args = buildArgs(request);
      if (!Array.isArray(args)) throw new TypeError('Warp buildArgs must return an argument array');
      return processRunner.execute({
        executionId: request.executionId,
        command: executable,
        args,
        cwd: request.cwd || request.workspace?.path,
        env: request.env || {},
        timeoutMs: request.timeoutMs || 0,
        signal: request.signal || null,
        onOutput: request.onOutput || null,
      });
    },

    cancel(executionId) {
      return processRunner.cancel?.(executionId) || false;
    },
  });
}
