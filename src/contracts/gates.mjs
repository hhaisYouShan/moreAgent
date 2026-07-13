import { DecisionType, GateConclusion, IssueSeverity } from '../domain/enums.mjs';

const OPEN_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'READY_FOR_RECHECK']);
const CLOSED_STATUSES = new Set(['CLOSED', 'DEFERRED']);
const DECISION_TYPES = new Set(Object.values(DecisionType));

export function normalizeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

export function expectedGateForPhase({ phase, phaseGateMap = {} }) {
  return phaseGateMap[normalizeToken(phase)] || null;
}

export function validateGateResult({ result, registeredGates = [], expectedGate = null, ownerAgent = null, file = null }) {
  const issues = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return invalid('gate_result_contract_invalid', 'Gate result must be a JSON object.');
  }

  const allowed = new Set(registeredGates.map(normalizeToken));
  const declaredGate = normalizeToken(result.gateType ?? result.gate_type ?? result.gate);
  const expected = normalizeToken(expectedGate);
  if (expected && !allowed.has(expected)) issues.push(issue('gate_result_gate_type_unregistered', `Workflow gate is not registered: ${expected}.`, IssueSeverity.BLOCKING, 'SYSTEM'));
  if (declaredGate && !allowed.has(declaredGate)) issues.push(issue('gate_result_gate_type_unregistered', `Gate result declares an unregistered gate: ${declaredGate}.`, IssueSeverity.BLOCKING, 'SYSTEM'));
  if (expected && declaredGate && expected !== declaredGate) issues.push(issue('gate_result_gate_type_mismatch', `Expected ${expected}, received ${declaredGate}.`, IssueSeverity.BLOCKING, 'SYSTEM'));

  const conclusion = normalizeConclusion(result.conclusion);
  const rawIssues = Array.isArray(result.issues) ? result.issues : [];
  const open = rawIssues.filter((item) => OPEN_STATUSES.has(normalizeToken(item?.status || 'OPEN')));
  const declaredOpen = numberOrNull(result.open_issue_count ?? result.openIssueCount);
  const allows = booleanOrNull(result.allows_next_stage ?? result.allowsNextStage);

  if (!conclusion) issues.push(issue('gate_result_conclusion_missing', 'Conclusion must be APPROVED, CHANGES_REQUESTED, BLOCKED, or FAILED.'));
  if (conclusion === GateConclusion.APPROVED && open.length) issues.push(issue('gate_result_approved_with_open_issues', 'APPROVED cannot contain OPEN issues.'));
  if (conclusion === GateConclusion.APPROVED && allows !== true) issues.push(issue('gate_result_approved_without_next_stage', 'APPROVED requires allows_next_stage=true.'));
  if (conclusion && conclusion !== GateConclusion.APPROVED && !open.length && !hasReason(result)) issues.push(issue('gate_result_failed_without_reason', 'A non-APPROVED result requires an OPEN issue or failure reason.'));
  if (declaredOpen !== null && declaredOpen !== open.length) issues.push(issue('gate_result_open_issue_count_mismatch', `Declared ${declaredOpen}, actual ${open.length}.`));

  for (const item of rawIssues) {
    const status = normalizeToken(item?.status || 'OPEN');
    if (!OPEN_STATUSES.has(status) && !CLOSED_STATUSES.has(status)) issues.push(issue('gate_result_issue_status_invalid', `Invalid issue status: ${item?.status ?? 'EMPTY'}.`));
    const decisionType = normalizeToken(item?.decision_type ?? item?.decisionType);
    if (OPEN_STATUSES.has(status) && !DECISION_TYPES.has(decisionType)) issues.push(issue('gate_result_issue_decision_type_missing', 'Every OPEN issue requires a canonical decision type.'));
  }

  return {
    valid: issues.length === 0,
    conclusion,
    allowsNextStage: allows,
    gateType: declaredGate || expected || null,
    openIssueCount: open.length,
    closedIssueCount: rawIssues.length - open.length,
    issues: issues.map((value) => ({ ...value, owner_agent: ownerAgent, target_files: file ? [file] : [] })),
  };

  function invalid(kind, message) {
    return { valid: false, conclusion: null, allowsNextStage: null, gateType: null, openIssueCount: 0, closedIssueCount: 0, issues: [issue(kind, message)] };
  }
}

function issue(kind, message, severity = IssueSeverity.MAJOR, category = 'OUTPUT_CONTRACT') {
  return {
    kind,
    failure_reason: kind,
    message,
    severity,
    category,
    status: 'OPEN',
    decision_type: category === 'SYSTEM' ? DecisionType.SYSTEM_RECOVERY_REQUIRED : DecisionType.AUTO_FIXABLE,
    requires_user_decision: false,
    task_kind: category === 'SYSTEM' ? 'SYSTEM_RECOVERY' : 'GATE_RESULT_REPAIR',
  };
}

function normalizeConclusion(value) {
  const result = normalizeToken(value);
  return Object.values(GateConclusion).includes(result) ? result : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;
  const result = String(value || '').trim().toLowerCase();
  return ['true', 'yes', '是'].includes(result) ? true : ['false', 'no', '否'].includes(result) ? false : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function hasReason(result) {
  return Boolean(result.failure_reason || result.failureReason || result.reason || result.message);
}
