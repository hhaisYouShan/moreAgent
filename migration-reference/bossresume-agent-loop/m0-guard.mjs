import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const PRE_PRODUCT_PHASES = new Set(['INTAKE', 'PRODUCT_REVIEW']);

export function checkpointResultPathForFeature(featureKey) {
  const normalized = String(featureKey || 'bossresume-full-refactor').trim();
  return `agent-loop-docs/checkpoints/${normalized}-m0-baseline-checkpoint.json`;
}

export function evaluateM0Checkpoint({ repoRoot, workflowState = null } = {}) {
  const state = workflowState || readJson(path.join(repoRoot, 'agent-loop-docs/process/workflow-state.json'));
  const phase = String(state?.phase || '').trim().toUpperCase();
  const featureKey = state?.featureKey || state?.feature_key || 'bossresume-full-refactor';
  const required = PRE_PRODUCT_PHASES.has(phase);

  if (!required) {
    return { required: false, ok: true, effectiveApproval: true, phase, featureKey, resultPath: checkpointResultPathForFeature(featureKey), reasons: [] };
  }

  const relativeResultPath = checkpointResultPathForFeature(featureKey);
  const absoluteResultPath = path.join(repoRoot, relativeResultPath);
  const reasons = [];

  if (!existsSync(absoluteResultPath)) {
    return { required: true, ok: false, effectiveApproval: false, phase, featureKey, resultPath: relativeResultPath, artifactExists: false, reasons: ['checkpoint_result_missing'] };
  }

  const result = readJson(absoluteResultPath);
  if (!result) reasons.push('checkpoint_result_invalid_json');

  const expectedBaseSha = resolveMasterSha(repoRoot);
  const openBlocking = Number(result?.open_blocking_count ?? -1);
  const openMajor = Number(result?.open_major_count ?? -1);
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  const requiredVerifications = Array.isArray(result?.verification_results) ? result.verification_results.filter((item) => item?.required !== false) : [];

  const requiredFields = [
    ['schema_version', result?.schema_version],
    ['checkpoint_type', result?.checkpoint_type],
    ['project_id', result?.project_id],
    ['feature_key', result?.feature_key],
    ['status', result?.status],
    ['base_branch', result?.base_branch],
    ['base_sha', result?.base_sha],
    ['checked_at', result?.checked_at],
    ['checked_by', result?.checked_by],
    ['approved_by', result?.approved_by],
    ['approved_at', result?.approved_at],
    ['workflow_snapshot', result?.workflow_snapshot],
    ['mode', result?.mode],
    ['scope_guard', result?.scope_guard],
    ['state_source_reconciliation', result?.state_source_reconciliation],
    ['evidence_manifest_path', result?.evidence_manifest_path],
    ['verification_results', result?.verification_results],
    ['issues', result?.issues],
  ];
  for (const [name, value] of requiredFields) if (value === null || value === undefined || value === '') reasons.push(`missing_${name}`);

  if (result?.schema_version !== '1.0') reasons.push('schema_version_mismatch');
  if (result?.checkpoint_type !== 'M0_BASELINE') reasons.push('checkpoint_type_mismatch');
  if (result?.feature_key !== featureKey) reasons.push('feature_key_mismatch');
  if (result?.status !== 'APPROVED') reasons.push('status_not_approved');
  if (result?.base_branch !== 'master') reasons.push('base_branch_mismatch');
  if (!expectedBaseSha || result?.base_sha !== expectedBaseSha) reasons.push('base_sha_mismatch');

  const snapshot = result?.workflow_snapshot || {};
  const actualWorkflowStatus = String(state?.workflowStatus || state?.status || '').trim().toUpperCase();
  const actualPhase = String(state?.phase || '').trim().toUpperCase();
  const actualGate = String(state?.gate || '').trim().toUpperCase();
  const actualGateStatus = String(state?.gateStatus || state?.gate_status || '').trim().toUpperCase();
  const actualRound = Number(state?.round || 0);

  if (actualWorkflowStatus !== 'READY') reasons.push('current_workflow_status_not_ready');
  if (actualPhase !== 'INTAKE') reasons.push('current_workflow_phase_not_intake');
  if (actualRound !== 0) reasons.push('current_workflow_round_not_zero');
  if (actualGate !== 'NONE') reasons.push('current_workflow_gate_not_none');
  if (actualGateStatus !== 'DRAFT') reasons.push('current_workflow_gate_status_not_draft');

  if (snapshot.workflow_status !== 'READY') reasons.push('workflow_status_not_ready');
  if (snapshot.phase !== 'INTAKE') reasons.push('workflow_phase_not_intake');
  if (Number(snapshot.round) !== 0) reasons.push('workflow_round_not_zero');
  if (snapshot.gate !== 'NONE') reasons.push('workflow_gate_not_none');
  if (snapshot.gate_status !== 'DRAFT') reasons.push('workflow_gate_status_not_draft');
  if (snapshot.current_run_id !== null) reasons.push('current_run_present');
  if (Array.isArray(snapshot.active_task_ids) && snapshot.active_task_ids.length > 0) reasons.push('active_tasks_present');
  if (snapshot.workflow_status !== actualWorkflowStatus) reasons.push('workflow_snapshot_status_mismatch');
  if (snapshot.phase !== actualPhase) reasons.push('workflow_snapshot_phase_mismatch');
  if (Number(snapshot.round) !== actualRound) reasons.push('workflow_snapshot_round_mismatch');
  if (snapshot.gate !== actualGate) reasons.push('workflow_snapshot_gate_mismatch');
  if (snapshot.gate_status !== actualGateStatus) reasons.push('workflow_snapshot_gate_status_mismatch');

  const currentRun = readJson(path.join(repoRoot, '.agent-runs/current-run.json'));
  if (currentRun?.runId) reasons.push('current_runtime_run_present');
  const currentTasks = readJson(path.join(repoRoot, '.agent-runs/current-tasks.json'));
  if (Array.isArray(currentTasks?.tasks) && currentTasks.tasks.length > 0) reasons.push('current_runtime_tasks_present');

  const reconciliation = result?.state_source_reconciliation || {};
  if (reconciliation.status !== 'RECONCILED') reasons.push('state_sources_not_reconciled');
  const reconciliationPath = reconciliation.evidence_path ? path.join(repoRoot, reconciliation.evidence_path) : null;
  if (!reconciliationPath || !existsSync(reconciliationPath)) reasons.push('reconciliation_evidence_missing');
  if (!Number.isFinite(Date.parse(reconciliation.checked_at || ''))) reasons.push('reconciliation_checked_at_invalid');

  if (result?.mode?.single !== true) reasons.push('single_mode_not_enabled');
  if (result?.mode?.auto !== false) reasons.push('auto_mode_not_disabled');
  if (result?.scope_guard?.business_prd_modified !== false) reasons.push('business_prd_modified');
  if (result?.scope_guard?.business_code_modified !== false) reasons.push('business_code_modified');
  if (result?.scope_guard?.brain_has_business_code_write_permission !== false) reasons.push('brain_business_code_permission');

  const evidencePath = result?.evidence_manifest_path ? path.join(repoRoot, result.evidence_manifest_path) : null;
  if (!evidencePath || !existsSync(evidencePath)) reasons.push('evidence_manifest_missing');
  else {
    const evidence = readJson(evidencePath);
    if (evidence && (evidence.base_sha || evidence.baseSha) && (evidence.base_sha || evidence.baseSha) !== result?.base_sha) reasons.push('evidence_manifest_base_sha_mismatch');
  }

  if (requiredVerifications.length === 0) reasons.push('required_verifications_missing');
  for (const item of requiredVerifications) {
    if (item?.result !== 'PASS') reasons.push(`verification_not_pass:${item?.verification_id || 'unknown'}`);
    if (Number(item?.exit_code) !== 0) reasons.push(`verification_exit_code:${item?.verification_id || 'unknown'}`);
    if (!item?.command) reasons.push(`verification_command_missing:${item?.verification_id || 'unknown'}`);
    if (!item?.log_path) reasons.push(`verification_log_missing:${item?.verification_id || 'unknown'}`);
    if (!item?.executed_at) reasons.push(`verification_time_missing:${item?.verification_id || 'unknown'}`);
    if (!item?.commit_sha) reasons.push(`verification_commit_missing:${item?.verification_id || 'unknown'}`);
    else if (item.commit_sha !== result?.base_sha) reasons.push(`verification_commit_mismatch:${item?.verification_id || 'unknown'}`);
  }

  if (!Array.isArray(result?.checked_by) || result.checked_by.length === 0) reasons.push('checked_by_missing');
  const checkedAt = Date.parse(result?.checked_at || '');
  const approvedAt = Date.parse(result?.approved_at || '');
  if (!Number.isFinite(checkedAt)) reasons.push('checked_at_invalid');
  if (!Number.isFinite(approvedAt)) reasons.push('approved_at_invalid');
  if (Number.isFinite(checkedAt) && Number.isFinite(approvedAt) && approvedAt < checkedAt) reasons.push('approval_time_before_check');

  if (openBlocking !== 0) reasons.push('open_blocking_count_nonzero');
  if (openMajor !== 0) reasons.push('open_major_count_nonzero');
  if (issues.some((issue) => ['BLOCKING', 'BLOCKER', 'MAJOR'].includes(String(issue?.severity || '').toUpperCase()) && String(issue?.status || '').toUpperCase() === 'OPEN')) reasons.push('open_blocking_or_major_issue');

  return { required: true, ok: reasons.length === 0, effectiveApproval: reasons.length === 0, phase, featureKey, resultPath: relativeResultPath, artifactExists: true, expectedBaseSha, checkpointStatus: result?.status || null, reasons: unique(reasons) };
}

export function formatM0GuardCheck(evaluation) {
  if (!evaluation.required) return '当前 Phase 不需要 M0 启动前校验。';
  if (evaluation.ok) return `M0 已有效批准：${evaluation.resultPath}`;
  return `M0 未有效批准：${evaluation.resultPath}；原因：${evaluation.reasons.join(', ')}`;
}

function resolveMasterSha(repoRoot) {
  for (const ref of ['origin/master', 'master']) {
    const result = spawnSync('git', ['rev-parse', ref], { cwd: repoRoot, encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim();
  }
  return null;
}
function readJson(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
