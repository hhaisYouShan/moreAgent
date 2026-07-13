import { DecisionType, GateConclusion, IssueSeverity, IssueStatus } from '../domain/enums.mjs';

const PASSING_CHECKS = new Set(['PASS', 'SKIPPED_NOT_REQUIRED']);

export function evaluateGate({
  gateId,
  gateType,
  workflowId,
  phase,
  registeredGates = [],
  inputArtifactIds = [],
  deterministicChecks = [],
  issues = [],
  reviewerRecommendations = [],
  requiresUserConfirmation = false,
  userConfirmation = null,
  engineVersion = '1.0.0',
  now = () => new Date().toISOString(),
} = {}) {
  for (const [name, value] of Object.entries({ gateId, gateType, workflowId, phase })) {
    if (!value) throw new TypeError(`${name} is required`);
  }
  if (!registeredGates.includes(gateType)) throw gateError('UNREGISTERED_GATE', `Gate is not registered: ${gateType}.`);

  const openIssues = issues.filter((issue) => ![IssueStatus.CLOSED, IssueStatus.DEFERRED].includes(issue.status));
  const blockingIssues = openIssues.filter((issue) => issue.severity === IssueSeverity.BLOCKING);
  const majorIssues = openIssues.filter((issue) => issue.severity === IssueSeverity.MAJOR);
  const systemIssues = openIssues.filter((issue) => issue.decisionType === DecisionType.SYSTEM_RECOVERY_REQUIRED || issue.decision_type === DecisionType.SYSTEM_RECOVERY_REQUIRED);
  const failedChecks = deterministicChecks.filter((check) => !PASSING_CHECKS.has(check.status));
  const blockedChecks = failedChecks.filter((check) => check.status === 'BLOCKED');

  let conclusion;
  let failureReason = null;
  if (blockedChecks.length || systemIssues.length) {
    conclusion = GateConclusion.BLOCKED;
    failureReason = blockedChecks[0]?.reason || systemIssues[0]?.failureReason || systemIssues[0]?.failure_reason || 'system_recovery_required';
  } else if (requiresUserConfirmation && userConfirmation?.status !== 'APPROVED') {
    conclusion = GateConclusion.BLOCKED;
    failureReason = 'user_confirmation_required';
  } else if (failedChecks.length || blockingIssues.length || majorIssues.length) {
    conclusion = GateConclusion.CHANGES_REQUESTED;
    failureReason = failedChecks[0]?.reason || blockingIssues[0]?.failureReason || majorIssues[0]?.failureReason || 'changes_required';
  } else {
    conclusion = GateConclusion.APPROVED;
  }

  const recommendationSummary = reviewerRecommendations.map((recommendation) => ({
    reviewer: recommendation.reviewer,
    conclusion: recommendation.conclusion,
    note: recommendation.note || null,
  }));

  return Object.freeze({
    schemaVersion: '1.0',
    entityType: 'GATE_RESULT',
    gateId,
    gateType,
    workflowId,
    phase,
    conclusion,
    inputArtifactIds: Object.freeze([...new Set(inputArtifactIds)].sort()),
    issueIds: Object.freeze(openIssues.map((issue) => issue.issueId || issue.issue_id).filter(Boolean).sort()),
    openBlockingCount: blockingIssues.length,
    openMajorCount: majorIssues.length,
    allowsNextStage: conclusion === GateConclusion.APPROVED,
    failureReason,
    deterministicChecks: Object.freeze(deterministicChecks.map((check) => Object.freeze({ ...check }))),
    reviewerRecommendations: Object.freeze(recommendationSummary.map((item) => Object.freeze(item))),
    userConfirmationId: userConfirmation?.decisionId || userConfirmation?.acceptanceId || null,
    decidedAt: now(),
    engineVersion,
  });
}

export function assertGateAllowsTransition(gateResult) {
  if (gateResult?.conclusion !== GateConclusion.APPROVED || gateResult?.allowsNextStage !== true) {
    throw gateError('GATE_NOT_APPROVED', `Gate ${gateResult?.gateId || 'UNKNOWN'} does not allow a transition.`);
  }
  return gateResult;
}

function gateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
