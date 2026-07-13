export function evaluateTaskPolicy({
  task,
  agentContract,
  requestedTools = [],
  requestedPaths = [],
  budgetUsage = {},
  executionMode = 'single',
  policy = {},
} = {}) {
  if (!task?.taskId) throw new TypeError('task is required');
  if (!agentContract?.agentId) throw new TypeError('agentContract is required');

  const violations = [];
  if (task.ownerAgent !== agentContract.agentId) {
    violations.push(violation('OWNER_MISMATCH', `Task owner ${task.ownerAgent} does not match Agent ${agentContract.agentId}.`));
  }

  const allowedTools = new Set(agentContract.allowedTools || []);
  for (const tool of requestedTools) {
    if (!allowedTools.has(tool)) violations.push(violation('TOOL_NOT_ALLOWED', `Tool is not allowed: ${tool}.`, { tool }));
  }

  const editablePaths = [...new Set([...(agentContract.editablePaths || []), ...(task.editablePaths || [])])];
  const forbiddenPaths = [...new Set([...(agentContract.forbiddenPaths || []), ...(task.forbiddenPaths || [])])];
  for (const requestedPath of requestedPaths) {
    if (forbiddenPaths.some((path) => pathMatches(requestedPath, path))) {
      violations.push(violation('FORBIDDEN_PATH', `Path is forbidden: ${requestedPath}.`, { path: requestedPath }));
      continue;
    }
    if (!editablePaths.some((path) => pathMatches(requestedPath, path))) {
      violations.push(violation('PATH_OUTSIDE_SCOPE', `Path is outside editable scope: ${requestedPath}.`, { path: requestedPath }));
    }
  }

  if (executionMode === 'auto' && policy.autoEnabled !== true) {
    violations.push(violation('AUTO_DISABLED', 'Auto execution is disabled by policy.'));
  }

  const maxTokens = task.budget?.maxTokens ?? policy.maxTokensPerTask;
  const maxCost = task.budget?.maxCost ?? policy.maxCostPerTask;
  if (Number.isFinite(maxTokens) && Number(budgetUsage.tokens || 0) > maxTokens) {
    violations.push(violation('TOKEN_BUDGET_EXCEEDED', `Token usage ${budgetUsage.tokens} exceeds ${maxTokens}.`));
  }
  if (Number.isFinite(maxCost) && Number(budgetUsage.cost || 0) > maxCost) {
    violations.push(violation('COST_BUDGET_EXCEEDED', `Cost ${budgetUsage.cost} exceeds ${maxCost}.`));
  }

  if (policy.requireContextManifest !== false && !task.contextManifestId) {
    violations.push(violation('CONTEXT_MANIFEST_REQUIRED', 'Task requires a valid Context Manifest.'));
  }
  if (policy.requireAcceptanceCommands !== false && !(task.acceptanceCommands || []).length) {
    violations.push(violation('ACCEPTANCE_COMMAND_REQUIRED', 'Task requires at least one acceptance command.'));
  }

  return Object.freeze({
    allowed: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export function assertTaskPolicy(input) {
  const result = evaluateTaskPolicy(input);
  if (!result.allowed) {
    const error = new Error('Task policy denied execution.');
    error.code = 'POLICY_DENIED';
    error.violations = result.violations;
    throw error;
  }
  return result;
}

function pathMatches(candidate, boundary) {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedBoundary = normalizePath(boundary);
  if (!normalizedBoundary) return false;
  if (normalizedBoundary.endsWith('/**')) {
    const prefix = normalizedBoundary.slice(0, -3).replace(/\/$/, '');
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  return normalizedCandidate === normalizedBoundary || normalizedCandidate.startsWith(`${normalizedBoundary}/`);
}

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function violation(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}
