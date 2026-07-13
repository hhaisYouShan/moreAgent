import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const REGISTERED_GATE_TYPES = Object.freeze([
  'PRD_GATE',
  'ARCHITECTURE_GATE',
  'UI_GATE',
  'DESIGN_GATE',
  'TEST_GATE',
  'PRODUCT_ACCEPTANCE_GATE',
  'USER_ACCEPTANCE_GATE',
  'ARCHIVE_GATE',
]);

const REGISTERED_GATE_TYPE_SET = new Set(REGISTERED_GATE_TYPES);
const PRE_WORKFLOW_GATE = 'NONE';

const PHASE_GATE_MAP = Object.freeze({
  INTAKE: PRE_WORKFLOW_GATE,
  PRODUCT_REVIEW: 'PRD_GATE',
  PRD_REVIEW: 'PRD_GATE',
  ARCHITECTURE_IMPACT_REVIEW: 'ARCHITECTURE_GATE',
  ARCHITECTURE_DESIGN: 'ARCHITECTURE_GATE',
  ARCHITECTURE_REVIEW: 'ARCHITECTURE_GATE',
  UI_DESIGN: 'UI_GATE',
  DEVELOPMENT_DESIGN: 'DESIGN_GATE',
  DESIGN_REVIEW: 'DESIGN_GATE',
  IMPLEMENTATION: 'TEST_GATE',
  TESTING: 'TEST_GATE',
  REPAIR: 'TEST_GATE',
  PRODUCT_ACCEPTANCE: 'PRODUCT_ACCEPTANCE_GATE',
  USER_ACCEPTANCE: 'USER_ACCEPTANCE_GATE',
  ARCHIVE: 'ARCHIVE_GATE',
});

export function normalizeGateType(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

export function normalizeWorkflowPhase(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

export function isRegisteredGateType(value) {
  return REGISTERED_GATE_TYPE_SET.has(normalizeGateType(value));
}

export function expectedGateForPhase(phase) {
  return PHASE_GATE_MAP[normalizeWorkflowPhase(phase)] || null;
}

export function evaluateCurrentGateAllowlist({ repoRoot, workflowState = null } = {}) {
  const state = workflowState || readWorkflowState(repoRoot);
  if (!state) {
    return {
      required: false,
      ok: true,
      gate: null,
      phase: null,
      expectedGate: null,
      reasons: [],
      detail: 'workflow-state.json 不存在；本检查不替代 Workflow 初始化。',
    };
  }

  const gate = normalizeGateType(state.gate);
  const phase = normalizeWorkflowPhase(state.phase);
  const expectedGate = expectedGateForPhase(phase);
  const reasons = [];

  if (!expectedGate) reasons.push(`workflow_phase_unregistered:${phase || 'EMPTY'}`);

  if (gate === PRE_WORKFLOW_GATE) {
    if (expectedGate !== PRE_WORKFLOW_GATE) reasons.push(`none_gate_not_allowed_for_phase:${phase || 'EMPTY'}`);
  } else if (!isRegisteredGateType(gate)) {
    reasons.push(`gate_type_unregistered:${gate || 'EMPTY'}`);
  }

  if (expectedGate && gate !== expectedGate) {
    reasons.push(`gate_phase_mismatch:expected=${expectedGate},actual=${gate || 'EMPTY'}`);
  }

  return {
    required: true,
    ok: reasons.length === 0,
    gate: gate || null,
    phase: phase || null,
    expectedGate,
    reasons,
    detail: reasons.length
      ? `当前 Gate 非法：${reasons.join(', ')}。正式 Gate：${REGISTERED_GATE_TYPES.join(', ')}；NONE 仅允许 INTAKE。`
      : `Gate 合法：phase=${phase}, gate=${gate}`,
  };
}

function readWorkflowState(repoRoot) {
  if (!repoRoot) return null;
  const file = path.join(repoRoot, 'agent-loop-docs/process/workflow-state.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
