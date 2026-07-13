import { REGISTERED_GATE_TYPES, isRegisteredGateType, normalizeGateType } from './registered-gates.mjs';

const OPEN_STATUSES = new Set(['OPEN', 'PENDING', 'TODO', 'UNRESOLVED']);
const CLOSED_STATUSES = new Set(['CLOSED', 'RESOLVED', 'DONE', 'FIXED']);

export function validateGateResultContract(data, {
  ownerAgent = null,
  file = null,
  expectedGate = null,
} = {}) {
  const issues = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      issues: [contractIssue('gate_result_contract_invalid', 'Gate result must be a JSON object.', ownerAgent, file, 'SYSTEM')],
    };
  }

  validateCurrentGateType({ data, expectedGate, ownerAgent, file, issues });

  const conclusion = normalizeConclusion(data.conclusion);
  const rawIssues = Array.isArray(data.issues) ? data.issues : [];
  const openIssues = rawIssues.filter((item) => isOpenStatus(item?.status || 'OPEN'));
  const closedIssues = rawIssues.filter((item) => isClosedStatus(item?.status));
  const declaredOpenIssueCount = numberOrNull(data.open_issue_count ?? data.openIssueCount);
  const allowsNextStage = booleanOrNull(data.allows_next_stage ?? data.allowsNextStage);

  if (!conclusion) issues.push(contractIssue('gate_result_conclusion_missing', 'Gate result conclusion must be PASS, CHANGES_REQUESTED, BLOCKED, or FAIL.', ownerAgent, file));
  if (conclusion === 'PASS' && openIssues.length > 0) issues.push(contractIssue('gate_result_pass_with_open_issues', 'Gate result cannot be PASS while issues[] still contains OPEN items.', ownerAgent, file));
  if (conclusion === 'PASS' && allowsNextStage === false) issues.push(contractIssue('gate_result_pass_but_next_stage_false', 'Gate result cannot be PASS while allows_next_stage is false.', ownerAgent, file));
  if (conclusion && conclusion !== 'PASS' && openIssues.length === 0 && !hasFailureReason(data)) issues.push(contractIssue('gate_result_failed_without_reason', 'A non-PASS Gate result must contain an OPEN issue or an explicit failure reason.', ownerAgent, file));
  if (declaredOpenIssueCount !== null && declaredOpenIssueCount !== openIssues.length) issues.push(contractIssue('gate_result_open_issue_count_mismatch', `Declared open issue count ${declaredOpenIssueCount} does not match actual count ${openIssues.length}.`, ownerAgent, file));

  for (const item of rawIssues) {
    const status = normalizeStatus(item?.status || 'OPEN');
    if (!OPEN_STATUSES.has(status) && !CLOSED_STATUSES.has(status)) issues.push(contractIssue('gate_result_issue_status_invalid', `Gate issue status is invalid: ${item?.status ?? 'EMPTY'}.`, ownerAgent, file));
    if (isOpenStatus(status) && !normalizeDecisionType(item?.decision_type || item?.decisionType)) issues.push(contractIssue('gate_result_issue_decision_type_missing', 'Every OPEN Gate issue must set decision_type to AUTO_FIXABLE or HUMAN_DECISION_REQUIRED.', ownerAgent, file));
  }

  return {
    valid: issues.length === 0,
    conclusion,
    allowsNextStage,
    gateType: normalizeGateType(data.gateType ?? data.gate_type ?? data.gate ?? expectedGate) || null,
    openIssueCount: openIssues.length,
    closedIssueCount: closedIssues.length,
    issues,
  };
}

function validateCurrentGateType({ data, expectedGate, ownerAgent, file, issues }) {
  const normalizedExpectedGate = normalizeGateType(expectedGate);
  const declaredRaw = data.gateType ?? data.gate_type ?? data.gate;
  const normalizedDeclaredGate = normalizeGateType(declaredRaw);

  if (normalizedExpectedGate && !isRegisteredGateType(normalizedExpectedGate)) {
    issues.push(unregisteredGateIssue({ gate: normalizedExpectedGate, source: 'workflow_state', ownerAgent, file }));
    return;
  }
  if (normalizedDeclaredGate && !isRegisteredGateType(normalizedDeclaredGate)) {
    issues.push(unregisteredGateIssue({ gate: normalizedDeclaredGate, source: 'gate_result', ownerAgent, file }));
    return;
  }
  if (normalizedExpectedGate && normalizedDeclaredGate && normalizedDeclaredGate !== normalizedExpectedGate) {
    issues.push({
      ...contractIssue('gate_result_gate_type_mismatch', `Gate result gate type does not match current Workflow Gate. expected=${normalizedExpectedGate}, actual=${normalizedDeclaredGate}.`, ownerAgent, file, 'SYSTEM'),
      severity: 'BLOCKER',
      failure_reason: 'gate_result_gate_type_mismatch',
      task_kind: 'GATE_VERIFY',
    });
  }
}

function unregisteredGateIssue({ gate, source, ownerAgent, file }) {
  return {
    ...contractIssue('gate_result_gate_type_unregistered', `Unregistered current Gate type was rejected: ${gate || 'EMPTY'} (source=${source}). Allowed values: ${REGISTERED_GATE_TYPES.join(', ')}.`, ownerAgent || 'gate_verifier', file, 'SYSTEM'),
    severity: 'BLOCKER',
    failure_reason: 'gate_result_gate_type_unregistered',
    owner_agent: 'gate_verifier',
    task_kind: 'GATE_VERIFY',
  };
}

export function contractIssue(kind, message, ownerAgent, file, category = 'OUTPUT_CONTRACT') {
  return {
    category,
    decision_type: 'AUTO_FIXABLE',
    requires_user_decision: false,
    status: 'OPEN',
    severity: 'MAJOR',
    kind,
    failure_reason: kind,
    message,
    owner_agent: ownerAgent,
    target_files: file ? [file] : [],
    task_kind: category === 'OUTPUT_CONTRACT' ? 'GATE_RESULT_REPAIR' : 'GATE_VERIFY',
  };
}

function normalizeConclusion(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
  return ['PASS', 'CHANGES_REQUESTED', 'BLOCKED', 'FAIL'].includes(normalized) ? normalized : null;
}
function normalizeStatus(value) { return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_'); }
function isOpenStatus(value) { return OPEN_STATUSES.has(normalizeStatus(value)); }
function isClosedStatus(value) { return CLOSED_STATUSES.has(normalizeStatus(value)); }
function normalizeDecisionType(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
  return ['AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED'].includes(normalized) ? normalized : null;
}
function booleanOrNull(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', 'yes', '是'].includes(normalized)) return true;
  if (['false', 'no', '否'].includes(normalized)) return false;
  return null;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function hasFailureReason(data) { return Boolean(data.failure_reason || data.failureReason || data.reason || data.message); }
