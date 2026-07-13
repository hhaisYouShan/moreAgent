const SYSTEM_CATEGORIES = new Set(['SYSTEM']);
const HUMAN_DECISION_TYPE = 'HUMAN_DECISION_REQUIRED';
const AUTO_DECISION_TYPE = 'AUTO_FIXABLE';

export function classifyWorkflowOutcome({
  gateResult = {},
  issues = [],
  taskFailures = [],
  parserFailures = [],
  verifierResult = {},
  failureCount = 0,
  maxFailureCount = 3,
} = {}) {
  const normalizedIssues = [
    ...issues,
    ...taskFailures.map(normalizeFailureIssue),
    ...parserFailures.map(normalizeFailureIssue),
  ].filter(isOpenIssue);

  const systemIssues = normalizedIssues.filter(isSystemIssue);
  const humanIssues = normalizedIssues.filter(isHumanIssue);
  const autoIssues = normalizedIssues.filter((item) => !isSystemIssue(item) && !isHumanIssue(item));
  const gateStatus = normalizeGateStatus(gateResult.status || gateResult.conclusion);
  const verifierPassed = verifierResult.passed === true || gateStatus === 'APPROVED';

  if (systemIssues.length > 0) {
    return outcome({
      gateDecision: 'BLOCKED',
      workflowStatus: 'BLOCKED_BY_SYSTEM',
      controllerStep: 'SYSTEM_FIX',
      failureReason: firstFailureReason(systemIssues, 'system_error'),
      systemIssues,
      humanIssues,
      autoIssues,
    });
  }

  if (humanIssues.length > 0) {
    return outcome({
      gateDecision: 'BLOCKED',
      workflowStatus: 'NEEDS_USER',
      controllerStep: 'DECIDE',
      failureReason: firstFailureReason(humanIssues, 'human_decision_required'),
      systemIssues,
      humanIssues,
      autoIssues,
    });
  }

  if (autoIssues.length > 0) {
    if (Number(failureCount) >= Number(maxFailureCount)) {
      return outcome({
        gateDecision: 'BLOCKED',
        workflowStatus: 'BLOCKED_BY_SYSTEM',
        controllerStep: 'SYSTEM_FIX',
        failureReason: 'repeated_auto_fix_failure',
        systemIssues,
        humanIssues,
        autoIssues,
      });
    }

    return outcome({
      gateDecision: 'CHANGES_REQUESTED',
      workflowStatus: 'NEEDS_FIX',
      controllerStep: 'FIX',
      failureReason: firstFailureReason(autoIssues, 'changes_requested'),
      systemIssues,
      humanIssues,
      autoIssues,
    });
  }

  if (verifierPassed) {
    return outcome({
      gateDecision: 'APPROVED',
      workflowStatus: 'READY',
      controllerStep: 'PLAN',
      failureReason: null,
      systemIssues,
      humanIssues,
      autoIssues,
    });
  }

  return outcome({
    gateDecision: 'BLOCKED',
    workflowStatus: 'BLOCKED_BY_SYSTEM',
    controllerStep: 'SYSTEM_FIX',
    failureReason: verifierResult.failureReason || verifierResult.failure_reason || 'verifier_inconsistent',
    systemIssues,
    humanIssues,
    autoIssues,
  });
}

export function isSystemIssue(issue) {
  return SYSTEM_CATEGORIES.has(String(issue?.category || '').trim().toUpperCase());
}

export function isHumanIssue(issue) {
  if (isSystemIssue(issue)) return false;
  return normalizeDecisionType(issue?.decision_type || issue?.decisionType) === HUMAN_DECISION_TYPE || issue?.requires_user_decision === true;
}

export function normalizeDecisionType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === HUMAN_DECISION_TYPE) return HUMAN_DECISION_TYPE;
  return AUTO_DECISION_TYPE;
}

function outcome({ gateDecision, workflowStatus, controllerStep, failureReason, systemIssues, humanIssues, autoIssues }) {
  return {
    gateDecision,
    workflowStatus,
    controllerStep,
    failureReason,
    humanIssueCount: humanIssues.length,
    autoIssueCount: autoIssues.length,
    systemIssueCount: systemIssues.length,
    canAutoContinue: workflowStatus === 'READY' || workflowStatus === 'NEEDS_FIX',
    canRequestUserDecision: workflowStatus === 'NEEDS_USER',
    issueIds: {
      system: issueIds(systemIssues),
      human: issueIds(humanIssues),
      auto: issueIds(autoIssues),
    },
  };
}

function normalizeFailureIssue(value) {
  if (typeof value === 'string') {
    return {
      category: 'SYSTEM',
      decision_type: AUTO_DECISION_TYPE,
      failure_reason: value,
      status: 'OPEN',
    };
  }
  return {
    category: value?.category || 'SYSTEM',
    decision_type: value?.decision_type || AUTO_DECISION_TYPE,
    status: value?.status || 'OPEN',
    ...value,
  };
}

function isOpenIssue(issue) {
  const status = String(issue?.status || issue?.issue_status || 'OPEN').trim().toUpperCase();
  return !['CLOSED', 'RESOLVED', 'DONE', 'FIXED'].includes(status);
}

function normalizeGateStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'PASS') return 'APPROVED';
  return normalized;
}

function firstFailureReason(issues, fallback) {
  return issues.find((item) => item?.failure_reason || item?.failureReason)?.failure_reason
    || issues.find((item) => item?.failure_reason || item?.failureReason)?.failureReason
    || fallback;
}

function issueIds(issues) {
  return issues.map((item) => item.issue_id || item.id).filter(Boolean);
}
