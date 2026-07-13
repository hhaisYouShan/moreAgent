export function buildTaskContextPackage({
  task,
  workflowState,
  confirmedDecisions = [],
  assignedIssues = [],
  previousArtifacts = [],
  gateStandardSummary = null,
  requiredOutputs = [],
  forbiddenActions = [],
} = {}) {
  if (!task?.id) throw new Error('task.id is required');

  return {
    schema_version: '1.0',
    task: {
      id: task.id,
      kind: task.taskKind || task.task_kind || task.kind || null,
      agent: task.agent || null,
      phase: task.phase || workflowState?.phase || null,
      round: Number(task.round ?? workflowState?.round ?? 0),
    },
    current_state: workflowState ? compactWorkflowState(workflowState) : null,
    confirmed_decisions_summary: confirmedDecisions.map(compactDecision),
    assigned_issues: assignedIssues.map(compactIssue),
    relevant_previous_artifacts: previousArtifacts,
    gate_standard_summary: gateStandardSummary,
    required_outputs: requiredOutputs,
    forbidden_actions: forbiddenActions,
    reading_policy: {
      read_manifest_first: true,
      do_not_scan_full_history: true,
      do_not_read_main_workspace: true,
      missing_input_behavior: 'INPUT_MISSING',
    },
  };
}

export function compactWorkflowState(state) {
  return {
    feature_key: state.featureKey || state.feature_key || null,
    prd_path: state.prdPath || state.prd_path || null,
    project_type: state.projectType || state.project_type || null,
    phase: state.phase || null,
    gate: state.gate || null,
    gate_status: state.gateStatus || state.gate_status || null,
    workflow_status: state.workflowStatus || state.status || null,
    controller_step: state.controllerStep || state.step || null,
    failure_reason: state.failureReason || state.failure_reason || null,
    round: Number(state.round || 0),
  };
}

function compactDecision(decision) {
  return {
    id: decision.id || decision.issue_id || null,
    topic: decision.topic || decision.decision_topic || null,
    decision: decision.decision || decision.value || decision.answer || null,
    status: decision.status || 'CONFIRMED',
  };
}

function compactIssue(issue) {
  return {
    issue_id: issue.issue_id || issue.id || null,
    category: issue.category || null,
    decision_type: issue.decision_type || issue.decisionType || 'AUTO_FIXABLE',
    severity: issue.severity || null,
    problem: issue.problem || issue.message || null,
    expected_fix: issue.expected_fix || issue.expectedFix || null,
    target_files: issue.target_files || issue.targetFiles || [],
    status: issue.status || issue.issue_status || 'OPEN',
  };
}
