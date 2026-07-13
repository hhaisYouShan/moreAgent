import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CONFIRMED_DECISIONS_PATH = 'agent-loop-docs/process/confirmed-decisions.json';
const SYSTEM_FAILURE_KINDS = new Set([
  'task_execution_failed',
  'missing_output',
  'missing_self_check',
  'phase_self_check_incomplete',
  'missing_gate_result_json',
  'invalid_gate_result_json',
  'gate_result_conclusion_missing',
  'gate_result_issue_decision_type_missing',
  'gate_result_issue_status_invalid',
  'gate_result_pass_with_open_issues',
  'gate_result_open_issues_missing',
  'prd_review_standard_missing',
  'agent_not_found',
  'engine_failed',
  'git_mutation_blocked',
  'self_check_parse_failed',
  'allows_next_stage_parse_failed',
  'verifier_inconsistent',
  'state_source_split',
  'context_missing',
  'round_context_missing',
  'worktree_stale',
]);
const USER_DECISION_SAFE_TO_APPLY = new Set(['HUMAN_DECISION_REQUIRED']);

export function buildIssuesFromGateSummary(gateSummary, { gate = 'AUTO_GATE', confirmedDecisions = null } = {}) {
  const decisions = confirmedDecisions || readConfirmedDecisions(process.cwd());
  const bySignature = new Map();

  for (const row of (gateSummary.rows || []).filter((item) => !item.passed)) {
    const problems = buildProblems(row);
    for (const problem of problems) {
      const initialOwner = problem.ownerAgent || resolveOwnerAgent({ row, problem, gate });
      const decisionType = classifyDecisionType({ problem });
      const ownerAgent = decisionType === 'AUTO_FIXABLE' && initialOwner === 'brain_agent' ? row.agent : initialOwner;
      const targetFiles = unique(problem.targetFiles || row.expectedOutputs || []);
      const failureReason = classifyFailureReason(problem);
      const decisionTopic = decisionTopicForProblem(problem);
      const signature = issueSignature({ gate, problem, ownerAgent, targetFiles, failureReason, decisionTopic });
      const stableId = stableIssueId({ gate, signature });
      const appliedDecision = findAppliedDecision({ decisions, issueId: stableId, signature, gate, decisionTopic });
      const effectiveDecisionType = appliedDecision && USER_DECISION_SAFE_TO_APPLY.has(decisionType) ? 'AUTO_FIXABLE' : decisionType;
      const effectiveOwner = appliedDecision && ownerAgent === 'brain_agent' ? resolveOwnerAgent({ row, problem, gate }) : ownerAgent;
      const issue = {
        issue_id: stableId,
        display_index: 0,
        issue_signature: signature,
        decision_topic: decisionTopic || null,
        repeat_count: 1,
        repeated: false,
        duplicate_count: 1,
        gate,
        severity: problem.severity,
        category: classifyIssueCategory(problem, effectiveDecisionType),
        decision_type: effectiveDecisionType,
        requires_user_decision: effectiveDecisionType === 'HUMAN_DECISION_REQUIRED',
        failure_reason: failureReason,
        owner_agent: effectiveOwner,
        issue_type: problem.kind,
        source_task: row.task,
        source_agent: row.agent,
        source_file: problem.sourceFile || null,
        target_files: targetFiles,
        problem: problem.message,
        user_decision: appliedDecision?.decision || appliedDecision?.content || null,
        decision_id: appliedDecision?.id || null,
        decision_applied: Boolean(appliedDecision),
        expected_fix: expectedFixForDecision({ problem, decisionType: effectiveDecisionType, ownerAgent: effectiveOwner, appliedDecision }),
        verification: problem.verification || verificationForOwner(effectiveOwner),
        status: 'OPEN',
      };

      const existing = bySignature.get(signature);
      if (!existing) bySignature.set(signature, issue);
      else bySignature.set(signature, mergeIssue(existing, issue));
    }
  }

  return Array.from(bySignature.values()).map((issue, index) => ({ ...issue, display_index: index + 1 }));
}

export function annotateIssueRepeats(issues, previousIssues = []) {
  if (!issues.length || !previousIssues.length) return issues;
  const previousByKey = new Map();
  for (const issue of previousIssues) {
    const key = issue.decision_topic || issue.issue_signature;
    if (!key) continue;
    const previous = previousByKey.get(key);
    const count = Number(issue.repeat_count || 1);
    if (!previous || count > Number(previous.repeat_count || 1)) previousByKey.set(key, issue);
  }

  return issues.map((issue) => {
    const previous = previousByKey.get(issue.decision_topic || issue.issue_signature);
    if (!previous) return issue;
    const repeatCount = Number(previous.repeat_count || 1) + 1;
    return {
      ...issue,
      issue_id: previous.issue_id || issue.issue_id,
      repeat_count: repeatCount,
      repeated: repeatCount > 1,
      previous_issue_id: previous.issue_id || null,
      first_seen_round: previous.first_seen_round || previous.round || null,
    };
  });
}

export function parseIssuesMarkdown(content) {
  const text = String(content || '');
  const blocks = text.split(/\n##\s+/).slice(1);
  const issues = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const issueId = lines[0]?.trim() || null;
    if (!issueId) continue;
    const body = lines.slice(1).join('\n');
    issues.push({
      issue_id: issueId,
      display_index: Number(matchField(body, 'display_index') || 0),
      issue_signature: matchField(body, 'issue_signature'),
      decision_topic: matchField(body, 'decision_topic') || matchField(body, 'semantic_key'),
      repeat_count: Number(matchField(body, 'repeat_count') || 1),
      duplicate_count: Number(matchField(body, 'duplicate_count') || 1),
      severity: matchField(body, 'severity'),
      category: matchField(body, 'category'),
      decision_type: matchField(body, 'decision_type'),
      requires_user_decision: matchField(body, 'requires_user_decision') === 'true',
      failure_reason: matchField(body, 'failure_reason'),
      owner_agent: matchField(body, 'owner_agent'),
      issue_type: matchField(body, 'issue_type'),
      gate: matchField(body, 'gate'),
      source_task: matchField(body, 'source_task'),
      source_agent: matchField(body, 'source_agent'),
      status: matchField(body, 'status'),
      source_file: matchField(body, 'source_file'),
      target_files: parseInlineBackticks(matchLine(body, /^- target_files:\s*(.+)$/m)),
      problem: sectionText(body, 'Problem'),
      expected_fix: sectionText(body, 'Expected Fix'),
      verification: sectionText(body, 'Verification'),
      user_decision: sectionText(body, 'User Decision'),
    });
  }

  return issues.filter((issue) => issue.issue_signature);
}

export function renderIssuesMarkdown({ featureKey, round, gate, issues }) {
  const humanCount = issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').length;
  const autoCount = issues.filter((item) => item.decision_type === 'AUTO_FIXABLE').length;
  const repeatedCount = issues.filter((item) => Number(item.repeat_count || 1) > 1).length;
  const appliedDecisionCount = issues.filter((item) => item.decision_applied).length;
  const lines = [
    `# ${featureKey} Issues Round ${round}`,
    '',
    `Gate: \`${gate}\``,
    '',
    `Status: \`${issues.length ? 'OPEN' : 'EMPTY'}\``,
    `Auto Fixable: \`${autoCount}\``,
    `Human Decision Required: \`${humanCount}\``,
    `Applied User Decisions: \`${appliedDecisionCount}\``,
    `Repeated Issues: \`${repeatedCount}\``,
    '',
    '说明：`issue_id` 由 `issue_signature` 生成；同一 `decision_topic` 的语义问题会跨轮复用用户决策，不再重复询问。`display_index` 只用于阅读排序，不用于 /decide 匹配。',
    '',
  ];

  if (!issues.length) {
    lines.push('No open issues.', '');
    return lines.join('\n');
  }

  for (const issue of issues) {
    lines.push(`## ${issue.issue_id}`, '');
    lines.push(`- display_index: \`${issue.display_index || 0}\``);
    lines.push(`- issue_signature: \`${issue.issue_signature}\``);
    if (issue.decision_topic) lines.push(`- decision_topic: \`${issue.decision_topic}\``);
    lines.push(`- repeat_count: \`${issue.repeat_count || 1}\``);
    lines.push(`- duplicate_count: \`${issue.duplicate_count || 1}\``);
    lines.push(`- repeated: \`${Number(issue.repeat_count || 1) > 1}\``);
    if (issue.previous_issue_id) lines.push(`- previous_issue_id: \`${issue.previous_issue_id}\``);
    lines.push(`- severity: \`${issue.severity}\``);
    lines.push(`- category: \`${issue.category || 'IMPLEMENTATION'}\``);
    lines.push(`- decision_type: \`${issue.decision_type}\``);
    lines.push(`- requires_user_decision: \`${issue.requires_user_decision}\``);
    lines.push(`- failure_reason: \`${issue.failure_reason || 'unknown'}\``);
    lines.push(`- owner_agent: \`${issue.owner_agent}\``);
    lines.push(`- issue_type: \`${issue.issue_type}\``);
    lines.push(`- gate: \`${issue.gate}\``);
    lines.push(`- source_task: \`${issue.source_task}\``);
    lines.push(`- source_agent: \`${issue.source_agent}\``);
    if (issue.source_file) lines.push(`- source_file: \`${issue.source_file}\``);
    lines.push(`- target_files: ${(issue.target_files || []).map((file) => `\`${file}\``).join(', ') || '`N/A`'}`);
    lines.push(`- status: \`${issue.status}\``);
    if (issue.decision_applied) {
      lines.push(`- decision_applied: \`true\``);
      lines.push(`- decision_id: \`${issue.decision_id || 'N/A'}\``);
    }
    lines.push('', '### Problem', '', issue.problem || 'N/A', '');
    if (issue.user_decision) lines.push('### User Decision', '', issue.user_decision, '');
    lines.push('### Expected Fix', '', issue.expected_fix || 'N/A', '', '### Verification', '', issue.verification || 'N/A', '');
  }

  return lines.join('\n');
}

function buildProblems(row) {
  const problems = [];

  if (row.status !== 'done') {
    const kind = row.taskReason === 'git_mutation_blocked' ? 'git_mutation_blocked' : 'task_execution_failed';
    const outputHint = row.expectedOutputs?.length
      ? ` Expected outputs: ${row.expectedOutputs.join(', ')}.`
      : '';
    problems.push({
      kind,
      severity: row.status === 'failed' ? 'BLOCKER' : 'MAJOR',
      ownerAgent: row.taskReason === 'git_mutation_blocked' ? 'orchestrator' : row.agent,
      message: `Agent task status is \`${row.status}\` with exit code \`${row.exitCode}\`${row.taskReason ? ` and reason \`${row.taskReason}\`` : ''}.${outputHint}`,
      expectedFix: row.taskReason === 'git_mutation_blocked'
        ? 'Treat this as a system execution failure. Check whether output artifacts already exist, tighten the Agent prompt/runner git boundary, and then decide whether rerunning the same Agent is sufficient.'
        : 'Fix the agent execution failure and rerun the task.',
    });
  }

  if (row.decisionFactors?.failure_reason === 'self_check_parse_failed') {
    problems.push({
      kind: 'self_check_parse_failed',
      severity: 'BLOCKER',
      ownerAgent: 'gate_verifier',
      sourceFile: row.outputChecks?.[0]?.file || row.expectedOutputs?.[0] || null,
      targetFiles: [row.outputChecks?.[0]?.file || row.expectedOutputs?.[0]].filter(Boolean),
      message: 'Self Check markdown exists, but the verifier could not parse its conclusion.',
      expectedFix: 'Fix the Self Check parser or normalize the prompt/output format; this is a Gate/system problem, not a user decision.',
      failureReason: 'self_check_parse_failed',
      category: 'SYSTEM',
      decisionType: 'AUTO_FIXABLE',
    });
  }

  if (row.decisionFactors?.failure_reason === 'allows_next_stage_parse_failed') {
    problems.push({
      kind: 'allows_next_stage_parse_failed',
      severity: 'BLOCKER',
      ownerAgent: 'gate_verifier',
      sourceFile: row.outputChecks?.[0]?.file || row.expectedOutputs?.[0] || null,
      targetFiles: [row.outputChecks?.[0]?.file || row.expectedOutputs?.[0]].filter(Boolean),
      message: 'Self Check markdown exists, but the verifier could not parse "是否允许进入下一阶段".',
      expectedFix: 'Fix the Self Check parser or normalize the prompt/output format; this is a Gate/system problem, not a user decision.',
      failureReason: 'allows_next_stage_parse_failed',
      category: 'SYSTEM',
      decisionType: 'AUTO_FIXABLE',
    });
  }

  for (const file of row.missingOutputs || []) problems.push({ kind: 'missing_output', severity: 'BLOCKER', ownerAgent: row.agent, sourceFile: file, targetFiles: [file], message: `Expected output file was not created: \`${file}\`.`, expectedFix: 'Create the required output file and include a Self Check section.' });
  for (const file of row.selfCheckMissing || []) problems.push({ kind: 'missing_self_check', severity: 'MAJOR', ownerAgent: row.agent, sourceFile: file, targetFiles: [file], message: `Output file is missing required \`## Self Check\`: \`${file}\`.`, expectedFix: 'Add a Self Check section with conclusion, scope, completed items, issues, and next-stage permission.' });

  for (const item of row.phaseRequirementsMissing || []) {
    problems.push({ kind: 'phase_self_check_incomplete', severity: 'MAJOR', ownerAgent: row.agent, sourceFile: item.file, targetFiles: [item.file], message: `Output file Self Check does not cover phase requirements: \`${item.file}\`; missing ${item.missing.join(', ')}.`, expectedFix: 'Update the Self Check to cover every required phase-specific item and rerun the Gate.' });
  }

  for (const issue of row.semanticIssues || []) {
    problems.push({
      kind: issue.kind || 'structural_markdown_issue',
      severity: issue.severity || 'MAJOR',
      ownerAgent: issue.ownerAgent,
      sourceFile: issue.sourceFile || issue.file,
      targetFiles: issue.targetFiles || [issue.file].filter(Boolean),
      message: issue.message,
      expectedFix: issue.expectedFix || 'Resolve the structural output issue and rerun the Gate.',
      verification: issue.verification,
      decisionType: normalizeDecisionType(issue.decisionType || issue.decision_type),
      category: issue.category,
      failureReason: issue.failure_reason || issue.failureReason,
    });
  }

  for (const issue of row.gateResultIssues || []) {
    problems.push({
      kind: issue.kind || 'structured_gate_result_issue',
      severity: issue.severity || 'MAJOR',
      ownerAgent: issue.ownerAgent,
      sourceFile: issue.sourceFile || issue.file || row.gateResultFile,
      targetFiles: issue.targetFiles || [issue.file || row.gateResultFile].filter(Boolean),
      message: issue.message,
      expectedFix: issue.expectedFix || 'Update gate_result.json and rerun the Gate.',
      verification: issue.verification || 'Rerun agent loop and confirm the structured Gate result is PASS with no OPEN issues and no open questions.',
      decisionType: normalizeDecisionType(issue.decisionType || issue.decision_type),
      category: issue.category,
      failureReason: issue.failure_reason || issue.failureReason,
    });
  }

  for (const file of row.codeIntegrationConflicts || []) {
    problems.push({
      kind: 'code_integration_conflict',
      severity: 'BLOCKER',
      ownerAgent: 'brain_agent',
      sourceFile: file,
      targetFiles: [file],
      message: `Multiple implementation worktrees changed the same code file: \`${file}\`.`,
      expectedFix: 'Stop automatic progression and let Brain Agent decide which owner Agent should reconcile the conflicting implementation changes.',
      verification: 'Rerun agent loop after the conflict is reconciled and ensure the file is changed by only one owner or has an explicit integration result.',
      decisionType: 'HUMAN_DECISION_REQUIRED',
    });
  }

  for (const file of row.unsupportedCodeChanges || []) {
    problems.push({
      kind: 'unsupported_code_deletion',
      severity: 'BLOCKER',
      ownerAgent: 'brain_agent',
      sourceFile: file,
      targetFiles: [file],
      message: `Implementation deleted a code file, which cannot be auto-integrated safely: \`${file}\`.`,
      expectedFix: 'Confirm the deletion in the approved design or replace it with an explicit migration/rollback plan before rerunning the Gate.',
      verification: 'Rerun agent loop and ensure deleted files are either restored or explicitly approved with rollback coverage.',
      decisionType: 'HUMAN_DECISION_REQUIRED',
    });
  }

  for (const file of row.failedOutputs || []) problems.push({ kind: 'failed_self_check', severity: 'MAJOR', sourceFile: file, targetFiles: [file], message: `Output file Self Check is FAIL: \`${file}\`.`, expectedFix: 'Resolve the failed Self Check items or assign the required fix to the responsible Agent.' });
  for (const file of row.blockedOutputs || []) problems.push({ kind: 'blocked_self_check', severity: 'BLOCKER', ownerAgent: row.agent, sourceFile: file, targetFiles: [file], message: `Output file Self Check is BLOCKED: \`${file}\`.`, expectedFix: 'Structured gate_result.json must explicitly state whether this is AUTO_FIXABLE or HUMAN_DECISION_REQUIRED. Update gate_result.json and rerun the Gate.', decisionType: 'AUTO_FIXABLE' });
  for (const file of row.nextStageDenied || []) problems.push({ kind: 'next_stage_denied', severity: 'MAJOR', sourceFile: file, targetFiles: [file], message: `Output file does not allow entering the next stage: \`${file}\`.`, expectedFix: 'Address the listed issues before allowing the next stage.' });
  for (const file of row.disallowedChanges || []) problems.push({ kind: 'disallowed_business_change', severity: 'BLOCKER', ownerAgent: row.agent, sourceFile: file, targetFiles: [file], message: `Document-only task modified business code: \`${file}\`.`, expectedFix: 'Revert business-code changes from this worktree or rerun the task with code changes disabled.' });

  return problems;
}

function classifyDecisionType({ problem }) {
  if (SYSTEM_FAILURE_KINDS.has(problem.kind)) return 'AUTO_FIXABLE';
  const explicit = normalizeDecisionType(problem.decisionType || problem.decision_type);
  if (explicit) return explicit;
  if (['code_integration_conflict', 'integration_branch_conflict', 'unsupported_code_deletion', 'disallowed_business_change'].includes(problem.kind)) return 'HUMAN_DECISION_REQUIRED';
  return 'AUTO_FIXABLE';
}

function classifyFailureReason(problem) {
  if (problem.failureReason || problem.failure_reason) return problem.failureReason || problem.failure_reason;
  switch (problem.kind) {
    case 'task_execution_failed': return 'engine_failed';
    case 'git_mutation_blocked': return 'git_mutation_blocked';
    case 'missing_output': return 'missing_output';
    case 'missing_gate_result_json': return 'missing_output';
    case 'invalid_gate_result_json': return 'invalid_result';
    case 'gate_result_conclusion_missing': return 'invalid_result';
    case 'gate_result_issue_decision_type_missing': return 'invalid_result';
    case 'gate_result_issue_status_invalid': return 'invalid_result';
    case 'missing_self_check': return 'invalid_result';
    case 'self_check_parse_failed': return 'self_check_parse_failed';
    case 'allows_next_stage_parse_failed': return 'self_check_parse_failed';
    case 'phase_self_check_incomplete': return 'invalid_result';
    case 'code_integration_conflict': return 'merge_conflict';
    case 'integration_branch_conflict': return 'merge_conflict';
    case 'unsupported_code_deletion': return 'scope_violation';
    case 'disallowed_business_change': return 'scope_violation';
    case 'failed_self_check': return 'invalid_result';
    case 'blocked_self_check': return 'invalid_result';
    default:
      if (normalizeDecisionType(problem.decisionType || problem.decision_type) === 'HUMAN_DECISION_REQUIRED') return 'product_ambiguity';
      return 'invalid_result';
  }
}

function classifyIssueCategory(problem, decisionType) {
  const explicit = String(problem.category || '').trim().toUpperCase();
  if (['SYSTEM', 'OUTPUT_CONTRACT', 'BUSINESS', 'IMPLEMENTATION'].includes(explicit)) return explicit;
  const kind = String(problem.kind || '').trim().toLowerCase();
  const failureReason = String(problem.failureReason || problem.failure_reason || '').trim().toLowerCase();
  const systemKinds = ['task_execution_failed', 'git_mutation_blocked', 'verifier_inconsistent', 'state_source_split', 'self_check_parse_failed', 'allows_next_stage_parse_failed', 'phase_self_check_policy_mismatch', 'worktree_input_missing', 'worktree_input_hash_mismatch', 'worktree_manifest_invalid', 'controller_exception', 'output_sync_failed', 'agent_not_found'];
  const systemReasons = ['engine_failed', 'git_mutation_blocked', 'verifier_inconsistent', 'self_check_parse_failed', 'allows_next_stage_parse_failed', 'phase_self_check_policy_mismatch', 'state_source_split', 'worktree_input_missing', 'worktree_input_hash_mismatch', 'worktree_manifest_invalid', 'invalid_gate_result_json', 'gate_result_contract_invalid', 'missing_status_json', 'invalid_status_json', 'agent_timeout', 'controller_exception', 'output_sync_failed', 'repeated_auto_fix_failure', 'repeated_output_contract_failure'];

  if (systemReasons.includes(failureReason)) return 'SYSTEM';
  if (systemKinds.includes(kind)) return 'SYSTEM';
  if (kind.startsWith('gate_result_') || ['missing_output', 'missing_self_check', 'phase_self_check_incomplete', 'missing_gate_result_json'].includes(kind)) return 'OUTPUT_CONTRACT';
  if (decisionType === 'HUMAN_DECISION_REQUIRED') return 'BUSINESS';
  return 'IMPLEMENTATION';
}

function expectedFixForDecision({ problem, decisionType, ownerAgent, appliedDecision }) {
  if (appliedDecision) {
    const decision = appliedDecision.decision || appliedDecision.content || appliedDecision.summary || JSON.stringify(appliedDecision);
    return `${problem.expectedFix || '根据用户已确认决策修复该问题并重新运行 Gate。'}\n\n用户已确认决策：${decision}\n\n自动推进规则：该问题已经有 confirmed-decisions 记录，不允许再次提问；下一轮必须由 ${ownerAgent} 将决策落入 PRD/设计/实现产物。`;
  }
  if (decisionType === 'HUMAN_DECISION_REQUIRED') return problem.expectedFix || '停止自动推进，由主 Agent 向用户提问并确认关键决策。';
  return `${problem.expectedFix || '修复该问题并重新运行 Gate。'}\n\n自动推进规则：该问题归类为 AUTO_FIXABLE，不需要用户确认，下一轮应直接分派给 ${ownerAgent} 修复。`;
}

function resolveOwnerAgent({ row, problem, gate }) {
  if (problem.ownerAgent) return problem.ownerAgent;
  if (problem.kind === 'git_mutation_blocked') return 'orchestrator';
  if (['task_execution_failed', 'missing_output', 'missing_self_check', 'phase_self_check_incomplete', 'missing_gate_result_json', 'invalid_gate_result_json', 'gate_result_conclusion_missing', 'gate_result_issue_decision_type_missing'].includes(problem.kind)) return row.agent;

  const pathOwner = ownerFromPath(problem.sourceFile || firstTargetFile(problem));
  if (pathOwner) return pathOwner;

  switch (normalize(gate)) {
    case 'PRD_GATE': return 'product_agent';
    case 'ARCHITECTURE_GATE': return architectureOwner(row.agent);
    case 'UI_GATE': return 'ui_agent';
    case 'DESIGN_GATE':
    case 'TECH_GATE': return designOwner(row.agent);
    case 'TEST_GATE': return implementationOwner(row.agent);
    case 'PRODUCT_ACCEPTANCE_GATE': return row.agent === 'product_agent' ? 'product_agent' : implementationOwner(row.agent);
    case 'USER_ACCEPTANCE_GATE':
    case 'ARCHIVE_GATE': return 'brain_agent';
    default: return row.agent || 'brain_agent';
  }
}

function ownerFromPath(file) {
  const value = String(file || '').toLowerCase();
  if (!value) return null;
  if (value.startsWith('client/')) return 'frontend_agent';
  if (value.startsWith('server/')) return 'backend_agent';
  if (value.includes('/prd/')) return 'product_agent';
  if (value.includes('product-acceptance')) return 'product_agent';
  if (value.includes('ui-design') || value.includes('ui-')) return 'ui_agent';
  if (value.includes('frontend-dev-plan')) return 'frontend_agent';
  if (value.includes('backend-dev-plan')) return 'backend_agent';
  if (value.includes('frontend-architecture') || value.includes('frontend-architect')) return 'frontend_architect_agent';
  if (value.includes('backend-architecture') || value.includes('backend-architect')) return 'backend_architect_agent';
  if (value.includes('architecture-impact')) return 'test_agent';
  if (value.includes('test-plan') || value.includes('/test-reports/') || value.includes('test-')) return 'test_agent';
  if (value.includes('atomic-task-review')) return 'review_agent';
  return null;
}

function architectureOwner(agent) {
  if (['frontend_architect_agent', 'backend_architect_agent', 'test_agent'].includes(agent)) return agent;
  if (agent === 'frontend_agent') return 'frontend_architect_agent';
  if (agent === 'backend_agent') return 'backend_architect_agent';
  return 'frontend_architect_agent';
}

function designOwner(agent) {
  if (['product_agent', 'ui_agent', 'test_agent', 'frontend_architect_agent', 'backend_architect_agent', 'review_agent'].includes(agent)) return agent;
  if (agent === 'frontend_agent') return 'frontend_agent';
  if (agent === 'backend_agent') return 'backend_agent';
  return 'review_agent';
}

function implementationOwner(agent) {
  if (['frontend_agent', 'backend_agent', 'test_agent', 'repair_agent'].includes(agent)) return agent;
  return 'repair_agent';
}

function mergeIssue(a, b) {
  return {
    ...a,
    severity: moreSevere(a.severity, b.severity),
    duplicate_count: Number(a.duplicate_count || 1) + Number(b.duplicate_count || 1),
    target_files: unique([...(a.target_files || []), ...(b.target_files || [])]),
    source_task: uniqueString(a.source_task, b.source_task),
    source_agent: uniqueString(a.source_agent, b.source_agent),
  };
}

function moreSevere(a, b) {
  const rank = { BLOCKER: 3, MAJOR: 2, MINOR: 1 };
  return (rank[String(b || '').toUpperCase()] || 0) > (rank[String(a || '').toUpperCase()] || 0) ? b : a;
}

function firstTargetFile(problem) {
  return Array.isArray(problem.targetFiles) ? problem.targetFiles[0] : null;
}

function verificationForOwner(ownerAgent) {
  return `Rerun agent loop and ensure \`${ownerAgent}\` produces the required output with a PASS Self Check.`;
}

function findAppliedDecision({ decisions, issueId, signature, gate, decisionTopic }) {
  return decisions.find((record) => {
    if (normalize(record.status || 'CONFIRMED') !== 'CONFIRMED') return false;
    const type = normalize(record.type || record.decision_type || record.kind);
    if (!['ISSUE_DECISION', 'HUMAN_DECISION', 'PRODUCT_DECISION'].includes(type)) return false;
    if (record.gate && normalize(record.gate) !== normalize(gate)) return false;
    if (record.issue_id && String(record.issue_id) === issueId) return true;
    if (record.issue_signature && String(record.issue_signature) === signature) return true;
    if (decisionTopic && decisionTopicForRecord(record) === decisionTopic) return true;
    return false;
  });
}

function readConfirmedDecisions(repoRoot) {
  const file = path.join(repoRoot, CONFIRMED_DECISIONS_PATH);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed.decisions) ? parsed.decisions : [];
  } catch {
    return [];
  }
}

function stableIssueId({ gate, signature }) {
  const prefix = issuePrefix(gate);
  return `ISSUE-${prefix}-${stableHash(signature).slice(0, 6).toUpperCase()}`;
}

function issuePrefix(gate) {
  const normalized = normalize(gate);
  if (normalized.includes('PRD')) return 'PRD';
  if (normalized.includes('ARCHITECTURE')) return 'ARCH';
  if (normalized.includes('UI')) return 'UI';
  if (normalized.includes('DESIGN')) return 'DESIGN';
  if (normalized.includes('TEST')) return 'TEST';
  if (normalized.includes('ACCEPTANCE')) return 'ACC';
  return 'AUTO';
}

function issueSignature({ gate, problem, ownerAgent, targetFiles, failureReason, decisionTopic }) {
  if (decisionTopic) return `sig-${stableHash([gate, 'decision-topic', decisionTopic].join('|'))}`;
  const normalized = [gate, failureReason, ownerAgent, (targetFiles || []).join(','), normalizeProblem(problem.message)].join('|');
  return `sig-${stableHash(normalized)}`;
}

function decisionTopicForProblem(problem) {
  return decisionTopicFromText([problem.kind, problem.message, problem.expectedFix, (problem.targetFiles || []).join(' ')].join(' '));
}

function decisionTopicForRecord(record) {
  if (record.decision_topic || record.semantic_key) return String(record.decision_topic || record.semantic_key);
  return decisionTopicFromText([record.issue_type, record.decision, record.content, record.summary, record.raw_user_input].join(' '));
}

function decisionTopicFromText(value) {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return null;
  if (text.includes('jobs.status') || text.includes('applications.status') || text.includes('旧岗位状态') || text.includes('新投递状态') || text.includes('共存策略') || text.includes('state_machine_coexistence')) return 'prd.application_status_coexistence';
  if (text.includes('greeting_message') || text.includes('interview_prep') || text.includes('模板来源') || text.includes('ai_template_source_unknown')) return 'prd.ai_template_source';
  if (text.includes('careerprofile') || text.includes('career_profile') || text.includes('career profile')) return 'prd.career_profile_navigation';
  if (text.includes('活跃投递') || text.includes('同一 user_id + job_id') || text.includes('同一用户同一 job_id') || text.includes('active application')) return 'prd.active_application_uniqueness';
  if (text.includes('决策中心首页') || text.includes('dashboard') && text.includes('首页')) return 'prd.decision_center_homepage_scope';
  if (text.includes('optimized_resume_id') || text.includes('optimizedresume') || text.includes('resume_optimization_tasks')) return 'prd.optimized_resume_source';
  return null;
}

function normalizeProblem(value) {
  return String(value || '').toLowerCase().replace(/`[^`]+`/g, '`x`').replace(/auto-\d+/g, 'auto-x').replace(/round-\d+/g, 'round-x').replace(/\s+/g, ' ').trim();
}

function matchField(body, field) {
  const escapedField = escapeRegExp(field);
  const regex = new RegExp('-\\s+' + escapedField + '\\s*[:：]\\s+`([^`]+)`', 'i');
  const match = String(body || '').match(regex);
  return match ? match[1].trim() : null;
}

function matchLine(body, regex) {
  return String(body || '').match(regex)?.[1]?.trim() || '';
}

function parseInlineBackticks(value) {
  return [...String(value || '').matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function sectionText(body, title) {
  const regex = new RegExp(`###\\s+${escapeRegExp(title)}\\s+([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
  return String(body || '').match(regex)?.[1]?.trim() || '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeDecisionType(value) {
  const normalized = normalize(value);
  return ['AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED'].includes(normalized) ? normalized : null;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function uniqueString(a, b) {
  return unique(String(a || '').split(',').concat(String(b || '').split(',')).map((value) => value.trim())).join(',');
}
