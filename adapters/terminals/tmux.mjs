export function createTmuxTerminalAdapter({
  processRunner,
  runnerId = 'tmux',
  executable = 'tmux',
  sessionPrefix = 'moreagent',
} = {}) {
  if (!processRunner?.execute) throw new TypeError('processRunner.execute is required');

  return Object.freeze({
    runnerId,
    runnerType: 'TMUX',
    capabilities: Object.freeze(['TERMINAL_SESSION', 'DETACHED', 'MULTI_WINDOW']),

    execute({ executionId, command, args = [], cwd, env = {}, sessionId = null, timeoutMs = 0, signal = null } = {}) {
      if (!command) throw new TypeError('command is required');
      const name = sanitize(sessionId || `${sessionPrefix}-${executionId}`);
      const shellCommand = quoteCommand(command, args);
      const tmuxArgs = ['new-session', '-d', '-s', name];
      if (cwd) tmuxArgs.push('-c', cwd);
      tmuxArgs.push(shellCommand);
      return processRunner.execute({
        executionId,
        command: executable,
        args: tmuxArgs,
        cwd,
        env,
        timeoutMs,
        signal,
      });
    },

    cancel(executionId) {
      return processRunner.cancel?.(executionId) || false;
    },
  });
}

function quoteCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value) {
  const text = String(value);
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function sanitize(value) {
  return String(value || 'moreagent').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
}
