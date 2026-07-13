export function createRunnerRegistry(initialRunners = []) {
  const runners = new Map();
  for (const runner of initialRunners) register(runner);

  return Object.freeze({
    register,
    unregister(runnerId) {
      return runners.delete(runnerId);
    },
    get(runnerId) {
      return runners.get(runnerId) || null;
    },
    require(runnerId) {
      const runner = runners.get(runnerId);
      if (!runner) throw runnerError('RUNNER_NOT_FOUND', `Runner is not registered: ${runnerId}.`);
      return runner;
    },
    select({ runnerId = null, capabilities = [] } = {}) {
      if (runnerId) {
        const runner = this.require(runnerId);
        assertCapabilities(runner, capabilities);
        return runner;
      }
      const candidates = [...runners.values()]
        .filter((runner) => capabilities.every((capability) => runner.capabilities.includes(capability)))
        .sort((left, right) => left.runnerId.localeCompare(right.runnerId));
      if (!candidates.length) throw runnerError('RUNNER_CAPABILITY_UNAVAILABLE', `No Runner provides: ${capabilities.join(', ')}.`);
      return candidates[0];
    },
    list() {
      return Object.freeze([...runners.values()].map(publicRunner).sort((left, right) => left.runnerId.localeCompare(right.runnerId)));
    },
  });

  function register(runner) {
    validateRunner(runner);
    if (runners.has(runner.runnerId)) throw runnerError('RUNNER_ALREADY_REGISTERED', `Runner is already registered: ${runner.runnerId}.`);
    runners.set(runner.runnerId, Object.freeze({
      ...runner,
      capabilities: Object.freeze([...new Set(runner.capabilities || [])].sort()),
    }));
    return runners.get(runner.runnerId);
  }
}

export function validateRunner(runner) {
  if (!runner || typeof runner !== 'object') throw new TypeError('runner must be an object');
  if (!runner.runnerId || typeof runner.runnerId !== 'string') throw new TypeError('runner.runnerId is required');
  if (!Array.isArray(runner.capabilities)) throw new TypeError('runner.capabilities must be an array');
  if (typeof runner.execute !== 'function') throw new TypeError('runner.execute must be a function');
  if (runner.cancel !== undefined && typeof runner.cancel !== 'function') throw new TypeError('runner.cancel must be a function when provided');
  return runner;
}

function assertCapabilities(runner, capabilities) {
  const missing = capabilities.filter((capability) => !runner.capabilities.includes(capability));
  if (missing.length) throw runnerError('RUNNER_CAPABILITY_MISMATCH', `${runner.runnerId} is missing capabilities: ${missing.join(', ')}.`);
}

function publicRunner(runner) {
  return Object.freeze({
    runnerId: runner.runnerId,
    runnerType: runner.runnerType || 'CUSTOM',
    capabilities: runner.capabilities,
  });
}

function runnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
