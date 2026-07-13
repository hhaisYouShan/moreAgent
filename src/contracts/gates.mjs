const OPEN_STATUSES = new Set(['OPEN', 'PENDING', 'TODO', 'UNRESOLVED']);
const CLOSED_STATUSES = new Set(['CLOSED', 'RESOLVED', 'DONE', 'FIXED']);

export function normalizeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

export function expectedGateForPhase({ phase, phaseGateMap = {} }) {
  return phaseGateMap[normalizeToken(phase)] || null;
}

export function validateGateResult({ result, registeredGates = [], expectedGate = null, ownerAgent = null, file = null }) {
  const issues = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return invalid('gate_result_contract_invalid', 'Gate result must be a JSON object.');
  const allowed = new Set(registeredGates.map(normalizeToken));
  const declaredGate = normalizeToken(result.gateType ?? result.gate_type ?? result.gate);
  const expected = normalizeToken(expectedGate);
  if (expected && !allowed.has(expected)) issues.push(issue('gate_result_gate_type_unregistered', `Workflow gate is not registered: ${expected}.`, 'BLOCKER', 'SYSTEM'));
  if (declaredGate && !allowed.has(declaredGate)) issues.push(issue('gate_result_gate_type_unregistered', `Gate result declares an unregistered gate: ${declaredGate}.`, 'BLOCKER', 'SYSTEM'));
  if (expected && declaredGate && expected !== declaredGate) issues.push(issue('gate_result_gate_type_mismatch', `Expected ${expected}, received ${declaredGate}.`, 'BLOCKER', 'SYSTEM'));

  const conclusion = normalizeConclusion(result.conclusion);
  const rawIssues = Array.isArray(result.issues) ? result.issues : [];
  const open = rawIssues.filter((item) => OPEN_STATUSES.has(normalizeToken(item?.status || 'OPEN')));
  const declaredOpen = numberOrNull(result.open_issue_count ?? result.openIssueCount);
  const allows = booleanOrNull(result.allows_next_stage ?? result.allowsNextStage);
  if (!conclusion) issues.push(issue('gate_result_conclusion_missing', 'Conclusion must be PASS, CHANGES_REQUESTED, BLOCKED, or FAIL.'));
  if (conclusion === 'PASS' && open.length) issues.push(issue('gate_result_pass_with_open_issues', 'PASS cannot contain OPEN issues.'));
  if (conclusion === 'PASS' && allows === false) issues.push(issue('gate_result_pass_but_next_stage_false', 'PASS requires allows_next_stage=true.'));
  if (conclusion && conclusion !== 'PASS' && !open.length && !hasReason(result)) issues.push(issue('gate_result_failed_without_reason', 'Non-PASS requires an OPEN issue or failure reason.'));
  if (declaredOpen !== null && declaredOpen !== open.length) issues.push(issue('gate_result_open_issue_count_mismatch', `Declared ${declaredOpen}, actual ${open.length}.`));
  for (const item of rawIssues) {
    const status = normalizeToken(item?.status || 'OPEN');
    if (!OPEN_STATUSES.has(status) && !CLOSED_STATUSES.has(status)) issues.push(issue('gate_result_issue_status_invalid', `Invalid issue status: ${item?.status ?? 'EMPTY'}.`));
    if (OPEN_STATUSES.has(status) && !['AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED'].includes(normalizeToken(item?.decision_type ?? item?.decisionType))) issues.push(issue('gate_result_issue_decision_type_missing', 'Every OPEN issue requires a decision type.'));
  }
  return { valid: issues.length === 0, conclusion, allowsNextStage: allows, gateType: declaredGate || expected || null, openIssueCount: open.length, closedIssueCount: rawIssues.length - open.length, issues: issues.map((value) => ({ ...value, owner_agent: ownerAgent, target_files: file ? [file] : [] })) };

  function invalid(kind, message) { return { valid: false, conclusion: null, allowsNextStage: null, gateType: null, openIssueCount: 0, closedIssueCount: 0, issues: [issue(kind, message)] }; }
}

function issue(kind, message, severity = 'MAJOR', category = 'OUTPUT_CONTRACT') { return { kind, failure_reason: kind, message, severity, category, status: 'OPEN', decision_type: 'AUTO_FIXABLE', requires_user_decision: false, task_kind: category === 'SYSTEM' ? 'GATE_VERIFY' : 'GATE_RESULT_REPAIR' }; }
function normalizeConclusion(value) { const result = normalizeToken(value); return ['PASS', 'CHANGES_REQUESTED', 'BLOCKED', 'FAIL'].includes(result) ? result : null; }
function booleanOrNull(value) { if (value === true || value === false) return value; const result = String(value || '').trim().toLowerCase(); return ['true', 'yes', '是'].includes(result) ? true : ['false', 'no', '否'].includes(result) ? false : null; }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function hasReason(result) { return Boolean(result.failure_reason || result.failureReason || result.reason || result.message); }
