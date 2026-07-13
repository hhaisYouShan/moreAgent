import { spawn } from 'node:child_process';

export function createLocalProcessRunner({ runnerId = 'local-process', maxOutputBytes = 10 * 1024 * 1024, killGraceMs = 2_000 } = {}) {
  const active = new Map();

  return Object.freeze({
    runnerId,
    runnerType: 'LOCAL_PROCESS',
    capabilities: Object.freeze(['HEADLESS', 'PROCESS', 'STDIO', 'CANCELLATION', 'TIMEOUT']),

    execute({ executionId, command, args = [], cwd, env = {}, stdin = null, timeoutMs = 0, signal = null, onOutput = null } = {}) {
      if (!executionId) throw new TypeError('executionId is required');
      if (!command) throw new TypeError('command is required');
      if (active.has(executionId)) throw runnerError('EXECUTION_ALREADY_ACTIVE', `Execution is already active: ${executionId}.`);
      if (!Array.isArray(args)) throw new TypeError('args must be an array');
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be a non-negative integer');

      return new Promise((resolve) => {
        const startedAt = new Date().toISOString();
        const child = spawn(command, args.map(String), {
          cwd,
          env: { ...process.env, ...env },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let outputBytes = 0;
        let settled = false;
        let terminationReason = null;
        let timeoutHandle = null;
        let forceKillHandle = null;

        active.set(executionId, Object.freeze({ child, startedAt }));

        const append = (stream, chunk) => {
          const text = chunk.toString();
          outputBytes += Buffer.byteLength(text);
          if (outputBytes > maxOutputBytes) {
            terminationReason = 'OUTPUT_LIMIT';
            terminate('SIGTERM');
            return;
          }
          if (stream === 'stdout') stdout += text;
          else stderr += text;
          onOutput?.({ executionId, stream, text, at: new Date().toISOString() });
        };

        child.stdout.on('data', (chunk) => append('stdout', chunk));
        child.stderr.on('data', (chunk) => append('stderr', chunk));

        child.on('error', (error) => {
          finish({ status: 'FAILED', exitCode: null, signal: null, error: error.message });
        });

        child.on('close', (exitCode, closeSignal) => {
          const status = terminationReason === 'TIMEOUT'
            ? 'TIMED_OUT'
            : terminationReason === 'CANCELLED'
              ? 'CANCELLED'
              : terminationReason === 'OUTPUT_LIMIT'
                ? 'FAILED'
                : exitCode === 0
                  ? 'SUCCEEDED'
                  : 'FAILED';
          finish({ status, exitCode, signal: closeSignal, error: terminationReason === 'OUTPUT_LIMIT' ? 'output_limit_exceeded' : null });
        });

        const abort = () => {
          if (settled) return;
          terminationReason = 'CANCELLED';
          terminate('SIGTERM');
        };
        signal?.addEventListener('abort', abort, { once: true });

        if (timeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            if (settled) return;
            terminationReason = 'TIMEOUT';
            terminate('SIGTERM');
          }, timeoutMs);
          timeoutHandle.unref?.();
        }

        if (stdin === null || stdin === undefined) child.stdin.end();
        else child.stdin.end(String(stdin));

        function terminate(killSignal) {
          if (child.exitCode !== null || child.killed) return;
          child.kill(killSignal);
          forceKillHandle = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
          }, killGraceMs);
          forceKillHandle.unref?.();
        }

        function finish({ status, exitCode, signal: resultSignal, error }) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          clearTimeout(forceKillHandle);
          signal?.removeEventListener('abort', abort);
          active.delete(executionId);
          resolve(Object.freeze({
            executionId,
            status,
            exitCode,
            signal: resultSignal,
            stdout,
            stderr,
            outputBytes,
            error,
            startedAt,
            finishedAt: new Date().toISOString(),
          }));
        }
      });
    },

    cancel(executionId) {
      const entry = active.get(executionId);
      if (!entry) return false;
      entry.child.kill('SIGTERM');
      return true;
    },

    activeExecutions() {
      return Object.freeze([...active.entries()].map(([executionId, entry]) => Object.freeze({ executionId, pid: entry.child.pid, startedAt: entry.startedAt })));
    },
  });
}

function runnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
