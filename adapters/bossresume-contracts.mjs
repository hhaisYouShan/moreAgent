const GATE_CONCLUSION_MAP = Object.freeze({
  PASS: 'APPROVED',
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  BLOCKED: 'BLOCKED',
  FAIL: 'FAILED',
  FAILED: 'FAILED',
});

const ISSUE_SEVERITY_MAP = Object.freeze({
  BLOCKER: 'BLOCKING',
  BLOCKING: 'BLOCKING',
  MAJOR: 'MAJOR',
  MINOR: 'MINOR',
});

export function adaptBossResumeGateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const conclusion = normalize(result.conclusion);
  return {
    ...result,
    conclusion: GATE_CONCLUSION_MAP[conclusion] || conclusion,
    issues: Array.isArray(result.issues)
      ? result.issues.map((issue) => ({
          ...issue,
          severity: ISSUE_SEVERITY_MAP[normalize(issue?.severity)] || issue?.severity,
        }))
      : [],
  };
}

export function adaptBossResumeWorkflowPhase(phase) {
  const value = normalize(phase);
  const map = {
    PRODUCT_REVIEW: 'PRODUCT_DESIGN',
    PRD_REVIEW: 'MULTI_ROLE_REVIEW',
    ARCHITECTURE_IMPACT_REVIEW: 'TECHNICAL_DESIGN',
    ARCHITECTURE_DESIGN: 'TECHNICAL_DESIGN',
    ARCHITECTURE_REVIEW: 'TECHNICAL_DESIGN',
    UI_DESIGN: 'TECHNICAL_DESIGN',
    DEVELOPMENT_DESIGN: 'TECHNICAL_DESIGN',
    DESIGN_REVIEW: 'TASK_PLANNING',
    TESTING: 'SYSTEM_TEST',
    ARCHIVE: 'ARCHIVED',
  };
  return map[value] || value;
}

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}
