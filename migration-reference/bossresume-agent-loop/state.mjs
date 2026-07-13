import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendAuditEvent, summarizeStateForAudit } from './audit-log.mjs';
import { classifyWorkflowOutcome } from './outcome-classifier.mjs';
import { buildWorkflowRecommendation } from './recommendation.mjs';

const DEFAULT_PRD_PATH = 'docs/prd/bossresume-full-refactor-prd.md';
const WORKFLOW_STATE_PATH = 'agent-loop-docs/process/workflow-state.md';
const WORKFLOW_STATE_JSON_PATH = 'agent-loop-docs/process/workflow-state.json';
const ROUND_CONTEXT_JSON_PATH = 'agent-loop-docs/process/round-context.json';
const MAX_FAILURE_COUNT = 3;
const SYSTEM_FAILURE_REASONS = new Set([
  'engine_failed',
  'git_mutation_blocked',
  'verifier_inconsistent',
  'self_check_parse_failed',
  'allows_next_stage_parse_failed',
  'state_source_split',
  'agent_not_found',
  'phase_self_check_policy_mismatch',
  'worktree_input_missing',
  'worktree_input_hash_mismatch',
  'worktree_manifest_invalid',
  'gate_result_contract_invalid',
  'invalid_gate_result_json',
  'missing_status_json',
  'invalid_status_json',
  'agent_timeout',
  'controller_exception',
  'output_sync_failed',
  'repeated_auto_fix_failure',
  'repeated_output_contract_failure',
]);
const PRD_REVIEW_OWNER_SET = new Set(['frontend_agent', 'backend_agent', 'test_agent', 'ui_agent']);
const STRUCTURAL_RECHECK_SKIP_TYPES = new Set([
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
]);

export function isSystemFailureReason(value) {
  return SYSTEM_FAILURE_REASONS.has(String(value || '').trim().toLowerCase());
}

export function systemOwnerAgentForFailureReason(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['self_check_parse_failed', 'allows_next_stage_parse_failed', 'phase_self_check_policy_mismatch', 'verifier_inconsistent', 'state_source_split', 'gate_result_contract_invalid', 'invalid_gate_result_json'].includes(normalized)) return 'gate_verifier';
  return 'orchestrator';
}

export async function readWorkflowState(repoRoot) {
  const markdownPath = path.join(repoRoot, WORKFLOW_STATE_PATH);
  const jsonPath = path.join(repoRoot, WORKFLOW_STATE_JSON_PATH);

  if (existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
      const raw = existsSync(markdownPath) ? await readFile(markdownPath, 'utf8') : '';
      const state = normalizeState({ ...parsed, raw, path: markdownPath, jsonPath });
      await auditStateSourceSplitIfNeeded({ repoRoot, jsonState: state, markdownRaw: raw });
      return state;
    } catch {
      // Fall back to markdown state when JSON is corrupted. The next write will regenerate JSON.
    }
  }

  const content = await readFile(markdownPath, 'utf8');
  return normalizeState(markdownStateFromContent({ content, markdownPath, jsonPath }));
}

export function parseWorkflowStateMarkdown({ content, markdownPath, jsonPath }) {
  return normalizeState(markdownStateFromContent({ content, markdownPath, jsonPath }));
}

export function hasCriticalWorkflowStateDifference(a = {}, b = {}) {
  return hasCriticalStateDifference(a, b);
}

export async function initializeWorkflowState({ repoRoot, prdPath = DEFAULT_PRD_PATH, featureKey = 'bossresume-full-refactor' }) {
  const statePath = path.join(repoRoot, WORKFLOW_STATE_PATH);
  const state = normalizeState({
    path: statePath,
    jsonPath: path.join(repoRoot, WORKFLOW_STATE_JSON_PATH),
    featureKey,
    prdPath,
    projectType: 'existing_refactor',
    productPrdEditMode: 'review_only',
    phase: 'INTAKE',
    round: 0,
    failureCount: 0,
    gate: 'NONE',
    gateStatus: 'DRAFT',
  });

  await writeWorkflowState({
    state,
    nextPhase: 'INTAKE',
    nextRound: 0,
    nextFailureCount: 0,
    nextGate: 'NONE',
    nextGateStatus: 'DRAFT',
    nextAgent: 'product_agent',
    ownerAgents: 'product_agent',
    nextInstruction: `总 Agent 已确认 PRD ${prdPath}。先看状态卡：npm run agent -- status。确认无阻塞后执行：npm run agent -- next。`,
    transitionMeta: { reason: 'initialize_workflow_state' },
  });
}

export async function writeWorkflowState({
  state,
  nextPhase,
  nextRound,
  nextFailureCount = state.failureCount || 0,
  nextGate,
  nextGateStatus,
  nextAgent,
  ownerAgents = nextAgent,
  nextInstruction,
  issuesPath,
  decisionPath,
  archivePath,
  workflowStatus,
  controllerStep,
  failureReason,
  transitionMeta = {},
}) {
  const prdPath = state.prdPath || DEFAULT_PRD_PATH;
  const projectType = normalizeProjectType(state.projectType);
  const normalizedGateStatus = normalizeGateStatus(nextGateStatus);
  const compactStatus = workflowStatus || workflowStatusForGate({ phase: nextPhase, gateStatus: normalizedGateStatus });
  const step = controllerStep || controllerStepForStatus({ status: compactStatus, gateStatus: normalizedGateStatus });
  const reason = failureReason || failureReasonForStatus({ status: compactStatus, gateStatus: normalizedGateStatus });
  const owner = ownerAgents || nextAgent || 'brain_agent';
  const productPrdEditMode = resolveProductPrdEditMode({ state, nextPhase, nextGateStatus: normalizedGateStatus, nextAgent, ownerAgents: owner });
  const markdownPath = state.path || path.join(process.cwd(), WORKFLOW_STATE_PATH);
  const jsonPath = state.jsonPath || path.join(process.cwd(), WORKFLOW_STATE_JSON_PATH);
  const contextPath = path.join(path.dirname(jsonPath), 'round-context.json');
  const previousAuditState = summarizeStateForAudit(state);
  const stateJson = normalizeState({
    path: markdownPath,
    jsonPath,
    featureKey: state.featureKey,
    prdPath,
    projectType,
    productPrdEditMode,
    status: compactStatus,
    workflowStatus: compactStatus,
    step,
    phase: normalizePhase(nextPhase),
    round: Number(nextRound || 0),
    iteration: Number(state.iteration || 0),
    failureCount: Number(nextFailureCount || 0),
    retryCount: Number(nextFailureCount || 0),
    failureReason: reason,
    gate: nextGate || gateForPhase(nextPhase),
    gateStatus: normalizedGateStatus,
    activeAgent: nextAgent || owner,
    nextAgent: nextAgent || owner,
    ownerAgent: owner,
    ownerAgents: owner,
    recentDecisionPath: decisionPath || state.recentDecisionPath || null,
    recentIssuesPath: issuesPath || state.recentIssuesPath || null,
    archivePath: archivePath || state.archivePath || null,
    nextInstruction: nextInstruction || '先运行 npm run agent -- status 查看状态卡；确认无阻塞后运行 npm run agent -- next。',
    updatedAt: new Date().toISOString(),
  });

  const content = renderWorkflowStateMarkdown({ state: stateJson });
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, content, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(stateJson, null, 2)}\n`, 'utf8');
  await writeFile(contextPath, `${JSON.stringify(renderRoundContext(stateJson), null, 2)}\n`, 'utf8');

  await appendAuditEvent({
    repoRoot: path.dirname(path.dirname(path.dirname(markdownPath))),
    event: 'workflow_state_transition',
    phase: stateJson.phase,
    gate: stateJson.gate,
    data: {
      from: previousAuditState,
      to: summarizeStateForAudit(stateJson),
      reason,
      human_issue_count: transitionMeta.humanIssueCount ?? transitionMeta.human_issue_count ?? null,
      auto_issue_count: transitionMeta.autoIssueCount ?? transitionMeta.auto_issue_count ?? null,
      issue_count: transitionMeta.issueCount ?? transitionMeta.issue_count ?? null,
      verifier_inconsistent: Boolean(transitionMeta.verifierInconsistent || transitionMeta.verifier_inconsistent),
      transition_source: transitionMeta.reason || transitionMeta.source || 'writeWorkflowState',
    },
    message: `workflow-state: ${previousAuditState.phase}/${previousAuditState.gate_status}/${previousAuditState.status} -> ${stateJson.phase}/${stateJson.gateStatus}/${stateJson.status}`,
  });
}

export async function reconcileWorkflowStateFromMarkdown({ repoRoot, actor = 'brain_agent', reason = 'brain_chat_completed' } = {}) {
  const markdownPath = path.join(repoRoot, WORKFLOW_STATE_PATH);
  const jsonPath = path.join(repoRoot, WORKFLOW_STATE_JSON_PATH);
  if (!existsSync(markdownPath)) return { reconciled: false, reason: 'markdown_missing' };

  const markdownRaw = await readFile(markdownPath, 'utf8');
  const markdownState = parseWorkflowStateMarkdown({ content: markdownRaw, markdownPath, jsonPath });
  let jsonState = null;
  let markdownStat = null;
  let jsonStat = null;

  try { jsonState = normalizeState(JSON.parse(await readFile(jsonPath, 'utf8'))); } catch { jsonState = null; }
  try { markdownStat = await stat(markdownPath); } catch { markdownStat = null; }
  try { jsonStat = await stat(jsonPath); } catch { jsonStat = null; }

  const differs = !jsonState || hasCriticalStateDifference(jsonState, markdownState);
  const markdownNewer = !jsonStat || !markdownStat || markdownStat.mtimeMs >= jsonStat.mtimeMs;
  if (!differs || !markdownNewer) return { reconciled: false, reason: differs ? 'markdown_not_newer' : 'already_consistent' };

  await appendAuditEvent({
    repoRoot,
    event: 'workflow_state_source_split',
    level: 'warn',
    phase: jsonState?.phase || markdownState.phase,
    gate: jsonState?.gate || markdownState.gate,
    agent: actor,
    data: {
      machine_source: jsonState ? summarizeStateForAudit(jsonState) : null,
      markdown_source: summarizeStateForAudit(markdownState),
      diagnostic: 'workflow-state.md was changed without matching workflow-state.json. Reconciling through writeWorkflowState().',
      reason,
    },
    message: '检测到 workflow-state.md 与 workflow-state.json 分裂，正在用统一状态写入函数修复。',
  });

  await writeWorkflowState({
    state: jsonState || markdownState,
    nextPhase: markdownState.phase,
    nextRound: Number(markdownState.round || 0),
    nextFailureCount: Number(markdownState.failureCount || 0),
    nextGate: markdownState.gate,
    nextGateStatus: markdownState.gateStatus,
    nextAgent: markdownState.nextAgent,
    ownerAgents: markdownState.ownerAgents,
    issuesPath: markdownState.recentIssuesPath,
    decisionPath: markdownState.recentDecisionPath,
    archivePath: markdownState.archivePath,
    workflowStatus: markdownState.status,
    controllerStep: markdownState.step,
    failureReason: markdownState.failureReason,
    nextInstruction: markdownState.nextInstruction,
    transitionMeta: { reason: 'reconcile_workflow_state_from_markdown', verifierInconsistent: true },
  });

  await appendAuditEvent({
    repoRoot,
    event: 'workflow_state_reconciled_from_markdown',
    level: 'warn',
    phase: markdownState.phase,
    gate: markdownState.gate,
    agent: actor,
    data: {
      to: summarizeStateForAudit(markdownState),
      reason,
    },
    message: '已将 Brain Agent 修改的 Markdown 状态同步到 workflow-state.json / round-context.json。',
  });

  return { reconciled: true, state: markdownState };
}

export function decideNextState({ state, gateSummary, issues = [], previousIssues = [] }) {
  const currentPhase = state.phase;
  const nextRound = Number(state.round || 0) + 1;
  const currentGate = gateForPhase(currentPhase);
  const currentGateStatus = normalizeGateStatus(state.gateStatus);

  if (gateSummary.status === 'APPROVED') {
    if (currentGateStatus === 'CHANGES_REQUESTED' && shouldRequireRecheck(previousIssues)) {
      const recheckAgents = recheckAgentForPhase(currentPhase);
      return {
        nextPhase: currentPhase,
        nextRound,
        nextFailureCount: 0,
        nextGate: currentGate,
        nextGateStatus: 'RECHECK_REQUIRED',
        nextAgent: recheckAgents,
        ownerAgents: recheckAgents,
        workflowStatus: 'NEEDS_FIX',
        controllerStep: 'VERIFY',
        failureReason: 'requires_recheck',
        nextInstruction: `修复基础检查通过。上一轮包含需要复查的业务/架构/实现类问题，必须先启动复查 Agent，再决定是否通过 ${currentGate}。复查 Agent：${recheckAgents}。`,
      };
    }

    const nextPhase = approvedNextPhase(currentPhase, state);
    const skippedRecheckText = currentGateStatus === 'CHANGES_REQUESTED' ? '上一轮问题均为结构化/格式类 AUTO_FIXABLE，修复通过后跳过额外复查。' : '';
    return {
      nextPhase,
      nextRound,
      nextFailureCount: 0,
      nextGate: gateForPhase(nextPhase),
      nextGateStatus: nextPhase === currentPhase && normalizePhase(nextPhase) === 'ARCHIVE' ? 'APPROVED' : 'DRAFT',
      nextAgent: agentForPhase(nextPhase),
      ownerAgents: agentForPhase(nextPhase),
      workflowStatus: normalizePhase(nextPhase) === 'ARCHIVE' && normalizePhase(currentPhase) === 'ARCHIVE' ? 'DONE' : 'READY',
      controllerStep: 'PLAN',
      failureReason: null,
      nextInstruction: `${skippedRecheckText}Gate ${currentGate} 已通过。下一阶段：${nextPhase}。PRD 修改模式已自动切回 review_only。先运行 npm run agent -- status 查看状态卡，再运行 npm run agent -- next --mode=single 继续推进。`,
    };
  }

  const failureCount = Number(state.failureCount || 0) + 1;
  const runtimeIssues = issues.map(normalizeRuntimeIssue);
  const verifierInconsistent = hasVerifierInconsistency(gateSummary);
  if (verifierInconsistent && !runtimeIssues.some((issue) => issue.category === 'SYSTEM' && issue.failure_reason === 'verifier_inconsistent')) {
    runtimeIssues.push({
      issue_id: 'SYSTEM-VERIFIER-INCONSISTENT',
      category: 'SYSTEM',
      decision_type: 'AUTO_FIXABLE',
      requires_user_decision: false,
      failure_reason: 'verifier_inconsistent',
      owner_agent: 'gate_verifier',
      status: 'OPEN',
    });
  }
  if (String(state.failureReason || '').trim().toLowerCase() === 'state_source_split') {
    runtimeIssues.push({
      issue_id: 'SYSTEM-STATE-SOURCE-SPLIT',
      category: 'SYSTEM',
      decision_type: 'AUTO_FIXABLE',
      requires_user_decision: false,
      failure_reason: 'state_source_split',
      owner_agent: 'gate_verifier',
      status: 'OPEN',
    });
  }

  const outcome = classifyWorkflowOutcome({
    gateResult: gateSummary,
    issues: runtimeIssues,
    verifierResult: {
      passed: false,
      failureReason: verifierInconsistent ? 'verifier_inconsistent' : primaryFailureReasonFromIssues(runtimeIssues),
    },
    failureCount,
    maxFailureCount: MAX_FAILURE_COUNT,
  });
  const repeatedSummary = summarizeRepeatedIssues(issues);
  const recommendation = buildWorkflowRecommendation({
    workflowStatus: outcome.workflowStatus,
    controllerStep: outcome.controllerStep,
    humanIssueIds: outcome.issueIds.human,
    ownerAgents: ownerAgentsFromIssues(runtimeIssues),
    failureReason: outcome.failureReason,
  });

  if (outcome.workflowStatus === 'BLOCKED_BY_SYSTEM') {
    const ownerAgent = systemOwnerAgentForFailureReason(outcome.failureReason);
    return {
      nextPhase: currentPhase,
      nextRound,
      nextFailureCount: failureCount,
      nextGate: currentGate,
      nextGateStatus: 'BLOCKED',
      nextAgent: 'brain_agent',
      ownerAgents: ownerAgent,
      workflowStatus: outcome.workflowStatus,
      controllerStep: outcome.controllerStep,
      failureReason: outcome.failureReason,
      nextInstruction: `${recommendation.message} 请先运行 npm run agent -- logs 查看强审计诊断。${repeatedSummary ? ` 重复根因：${repeatedSummary}。` : ''}`,
    };
  }

  if (outcome.workflowStatus === 'NEEDS_USER') {
    return {
      nextPhase: currentPhase,
      nextRound,
      nextFailureCount: failureCount,
      nextGate: currentGate,
      nextGateStatus: 'BLOCKED',
      nextAgent: 'brain_agent',
      ownerAgents: 'brain_agent',
      workflowStatus: outcome.workflowStatus,
      controllerStep: outcome.controllerStep,
      failureReason: outcome.failureReason,
      nextInstruction: `${recommendation.message} Issue：${outcome.issueIds.human.join(', ') || 'N/A'}。运行 npm run agent -- chat，由 Brain Agent 汇总后向用户确认。`,
    };
  }

  const autoIssues = runtimeIssues.filter((issue) => issue.category !== 'SYSTEM' && issue.decision_type !== 'HUMAN_DECISION_REQUIRED');
  const ownerAgents = ownerAgentsFromIssues(autoIssues) || repairAgentForPhase(currentPhase);
  const nextPhase = shouldAdvanceToPrdReview({ currentPhase, ownerAgents, issues: autoIssues }) ? 'PRD_REVIEW' : currentPhase;
  return {
    nextPhase,
    nextRound,
    nextFailureCount: failureCount,
    nextGate: gateForPhase(nextPhase),
    nextGateStatus: 'CHANGES_REQUESTED',
    nextAgent: ownerAgents,
    ownerAgents,
    workflowStatus: outcome.workflowStatus,
    controllerStep: outcome.controllerStep,
    failureReason: outcome.failureReason,
    nextInstruction: `${recommendation.message}${nextPhase === 'PRD_REVIEW' && currentPhase === 'INTAKE' ? ' Product 初审已完成，当前转入 PRD_REVIEW。' : ''}${repeatedSummary ? ` 重复根因：${repeatedSummary}。` : ''}`,
  };
}

function normalizeRuntimeIssue(issue = {}) {
  const decisionType = issue.decision_type === 'HUMAN_DECISION_REQUIRED' || issue.requires_user_decision === true
    ? 'HUMAN_DECISION_REQUIRED'
    : 'AUTO_FIXABLE';
  return {
    ...issue,
    category: normalizeIssueCategory(issue, decisionType),
    decision_type: decisionType,
    requires_user_decision: decisionType === 'HUMAN_DECISION_REQUIRED',
    failure_reason: issue.failure_reason || issue.failureReason || null,
    status: issue.status || 'OPEN',
  };
}

function normalizeIssueCategory(issue, decisionType) {
  const explicit = String(issue.category || '').trim().toUpperCase();
  if (['SYSTEM', 'OUTPUT_CONTRACT', 'BUSINESS', 'IMPLEMENTATION'].includes(explicit)) return explicit;
  const kind = String(issue.issue_type || issue.kind || '').trim().toLowerCase();
  const reason = String(issue.failure_reason || issue.failureReason || '').trim().toLowerCase();
  if (isSystemFailureReason(reason) || ['task_execution_failed', 'git_mutation_blocked', 'verifier_inconsistent', 'state_source_split', 'worktree_input_missing', 'worktree_input_hash_mismatch', 'self_check_parse_failed', 'allows_next_stage_parse_failed', 'phase_self_check_policy_mismatch'].includes(kind)) return 'SYSTEM';
  if (['missing_output', 'missing_self_check', 'phase_self_check_incomplete', 'missing_gate_result_json', 'gate_result_conclusion_missing', 'gate_result_issue_decision_type_missing', 'gate_result_issue_status_invalid', 'gate_result_pass_with_open_issues', 'gate_result_open_issues_missing', 'gate_result_pass_but_next_stage_false', 'gate_result_open_issue_count_mismatch'].includes(kind)) return 'OUTPUT_CONTRACT';
  if (decisionType === 'HUMAN_DECISION_REQUIRED') return 'BUSINESS';
  return 'IMPLEMENTATION';
}

function renderWorkflowStateMarkdown({ state }) {
  return `# bossResume Workflow State

当前需求：BossResume 前后端整体改造

feature-key：\`${state.featureKey}\`

PRD 路径：\`${state.prdPath}\`

项目类型：\`${state.projectType}\`

PRD 修改模式：\`${state.productPrdEditMode}\`

## 单一状态源

\`agent-loop-docs/process/workflow-state.json\` 是唯一机器事实源；本 Markdown、dashboard 和 completion-status 都只是展示层。Brain Agent 不允许只改 Markdown 状态；状态迁移必须通过统一写入函数同步 JSON / Markdown / Round Context。

## 压缩 Workflow 状态

- status：\`${state.status}\`
- step：\`${state.step}\`
- phase：\`${state.phase}\`
- active_agent：\`${state.activeAgent || state.nextAgent}\`
- owner_agent：\`${state.ownerAgent || state.ownerAgents || 'N/A'}\`
- failure_reason：\`${state.failureReason || 'null'}\`
- retry_count：\`${state.retryCount || 0}\`

## 兼容旧字段

当前阶段：\`${state.phase}\`

当前轮次：\`${state.round}\`

连续失败次数：\`${state.failureCount || 0}\`

当前 Gate：\`${state.gate}\`

Gate 状态：\`${state.gateStatus}\`

Issue Owner Agents：\`${state.ownerAgents || state.nextAgent}\`

## 最近产物

${state.recentDecisionPath ? `- Gate 决策：\`${state.recentDecisionPath}\`\n` : ''}${state.recentIssuesPath ? `- Issue 记录：\`${state.recentIssuesPath}\`\n` : ''}${state.archivePath ? `- 归档记录：\`${state.archivePath}\`\n` : ''}- Round Context：\`${ROUND_CONTEXT_JSON_PATH}\`
- Workflow JSON：\`${WORKFLOW_STATE_JSON_PATH}\`
- Audit Events：\`agent-loop-docs/process/audit-events.jsonl\`

## 待处理问题

${pendingText(state.gateStatus)}

## 阻塞问题

${state.status === 'NEEDS_USER'
  ? `- 当前存在必须由用户决策的问题，failure_reason=\`${state.failureReason || 'unknown'}\`。`
  : state.status === 'BLOCKED_BY_SYSTEM'
    ? `- 当前属于系统阻塞，failure_reason=\`${state.failureReason || 'unknown'}\`，不需要用户业务决策。请先执行 \`npm run agent -- logs\` 查看强审计诊断。`
    : '- 暂无。'}

## 下一步应该启动的 Agent

\`${state.nextAgent}\`

## Issue Owner Tracking

- owner_agents：\`${state.ownerAgents || state.nextAgent}\`
- source：\`${state.recentIssuesPath || 'N/A'}\`
- rule：Agent 只产出结果；Controller 读取 Verifier 结果后唯一推进 Workflow 状态。
- issue_id_rule：Issue ID 由 issue_signature / decision_topic 稳定生成，同一语义问题不重复询问用户。

## 下一步指令

\`\`\`text
${state.nextInstruction || '先运行 npm run agent -- status 查看状态卡；确认无阻塞后运行 npm run agent -- next。'}
\`\`\`

## 用户日常命令

\`\`\`bash
npm run agent -- start ${state.prdPath}
npm run agent -- status
npm run agent -- jobs
npm run agent -- logs
npm run agent -- chat
npm run agent -- next --preview
npm run agent -- next --mode=single
npm run agent -- doctor
\`\`\`

## 支持阶段

\`\`\`text
INTAKE -> PRODUCT_REVIEW -> PRD_REVIEW -> ARCHITECTURE_IMPACT_REVIEW -> UI_DESIGN -> DEVELOPMENT_DESIGN -> DESIGN_REVIEW -> IMPLEMENTATION -> TESTING -> PRODUCT_ACCEPTANCE -> USER_ACCEPTANCE -> ARCHIVE
new_project 额外包含：ARCHITECTURE_DESIGN -> ARCHITECTURE_REVIEW
\`\`\`

## 归档路径

- ${state.archivePath ? `\`${state.archivePath}\`` : '暂无。'}
`;
}

function renderRoundContext(state) {
  return {
    workflow_id: state.featureKey,
    feature_key: state.featureKey,
    prd_path: state.prdPath,
    project_type: state.projectType,
    product_prd_edit_mode: state.productPrdEditMode,
    status: state.status,
    step: state.step,
    phase: state.phase,
    workflow_round: state.round,
    gate: state.gate,
    gate_status: state.gateStatus,
    active_agent: state.activeAgent || state.nextAgent,
    owner_agent: state.ownerAgent || state.ownerAgents || null,
    failure_reason: state.failureReason || null,
    retry_count: state.retryCount || 0,
    latest_decision_file: state.recentDecisionPath || null,
    latest_issue_file: state.recentIssuesPath || null,
    confirmed_decisions_file: 'agent-loop-docs/process/confirmed-decisions.json',
    audit_events_file: 'agent-loop-docs/process/audit-events.jsonl',
    workflow_state_json: WORKFLOW_STATE_JSON_PATH,
    workflow_state_md: WORKFLOW_STATE_PATH,
    input_search_patterns: [
      `agent-loop-docs/reviews/${state.featureKey}-*-round-*.md`,
      `agent-loop-docs/gate-results/${state.featureKey}-*-round-*.json`,
      `agent-loop-docs/decisions/${state.featureKey}-*-round-*.md`,
      `agent-loop-docs/issues/${state.featureKey}-issues-round-*.md`,
    ],
    updated_at: state.updatedAt,
  };
}

function markdownStateFromContent({ content, markdownPath, jsonPath }) {
  return {
    path: markdownPath,
    jsonPath,
    raw: content,
    featureKey: matchValue(content, /feature-key：`([^`]+)`/) || 'bossresume-full-refactor',
    prdPath: matchValue(content, /PRD 路径：`([^`]+)`/) || DEFAULT_PRD_PATH,
    projectType: normalizeProjectType(matchValue(content, /项目类型：`([^`]+)`/) || 'existing_refactor'),
    productPrdEditMode: matchValue(content, /PRD 修改模式：`([^`]+)`/) || 'review_only',
    status: matchValue(content, /- status：`?([^`\n]+)`?/),
    step: matchValue(content, /- step：`?([^`\n]+)`?/),
    phase: normalizePhase(matchValue(content, /当前阶段：`?([^`\n]+)`?/) || matchValue(content, /- phase：`?([^`\n]+)`?/)),
    round: Number(matchValue(content, /当前轮次：`?(\d+)`?/) || 0),
    failureCount: Number(matchValue(content, /连续失败次数：`?(\d+)`?/) || matchValue(content, /- retry_count：`?(\d+)`?/) || 0),
    retryCount: Number(matchValue(content, /- retry_count：`?(\d+)`?/) || matchValue(content, /连续失败次数：`?(\d+)`?/) || 0),
    gate: matchValue(content, /当前 Gate：`?([^`\n]+)`?/) || 'NONE',
    gateStatus: normalizeGateStatus(matchValue(content, /Gate 状态：`?([^`\n]+)`?/) || 'DRAFT'),
    nextAgent: matchValue(content, /## 下一步应该启动的 Agent\s+`([^`]+)`/m) || '',
    ownerAgents:
      matchValue(content, /owner_agents：`([^`]+)`/) ||
      matchValue(content, /Issue Owner Agents：`([^`]+)`/) ||
      '',
    failureReason: matchValue(content, /- failure_reason：`?([^`\n]+)`?/) || null,
    recentDecisionPath: matchValue(content, /- Gate 决策：`([^`]+)`/),
    recentIssuesPath: matchValue(content, /- Issue 记录：`([^`]+)`/),
    archivePath: matchValue(content, /- 归档记录：`([^`]+)`/),
    nextInstruction: matchValue(content, /## 下一步指令\s+```text\s+([\s\S]*?)```/m),
  };
}

function normalizeState(value) {
  const gateStatus = normalizeGateStatus(value.gateStatus || value.gate_status || 'DRAFT');
  const phase = normalizePhase(value.phase || 'INTAKE');
  const failureReason = value.failureReason || value.failure_reason || null;
  const systemBlocked = gateStatus === 'BLOCKED' && isSystemFailureReason(failureReason);
  const rawStatus = value.status || value.workflowStatus || workflowStatusForGate({ phase, gateStatus, failureReason });
  const status = systemBlocked
    ? 'BLOCKED_BY_SYSTEM'
    : normalizeWorkflowStatus(rawStatus);
  const ownerAgent = systemBlocked ? systemOwnerAgentForFailureReason(failureReason) : (value.ownerAgent || value.owner_agent || value.ownerAgents || value.owner_agents || value.nextAgent || value.next_agent || agentForPhase(phase));
  const nextAgent = systemBlocked ? 'brain_agent' : (value.nextAgent || value.next_agent || value.activeAgent || value.active_agent || agentForPhase(phase));
  return {
    ...value,
    featureKey: value.featureKey || value.feature_key || 'bossresume-full-refactor',
    prdPath: value.prdPath || value.prd_path || DEFAULT_PRD_PATH,
    projectType: normalizeProjectType(value.projectType || value.project_type || 'existing_refactor'),
    productPrdEditMode: normalizeProductPrdEditMode(value.productPrdEditMode || value.product_prd_edit_mode || 'review_only'),
    status,
    workflowStatus: status,
    step: String(systemBlocked ? 'SYSTEM_FIX' : (value.step || controllerStepForStatus({ status, gateStatus }))).toUpperCase(),
    phase,
    round: Number(value.round || value.workflow_round || 0),
    failureCount: Number(value.failureCount || value.failure_count || 0),
    retryCount: Number(value.retryCount || value.retry_count || value.failureCount || 0),
    gate: value.gate || value.currentGate || gateForPhase(phase),
    gateStatus,
    nextAgent,
    activeAgent: systemBlocked ? 'brain_agent' : (value.activeAgent || value.active_agent || value.nextAgent || value.next_agent || agentForPhase(phase)),
    ownerAgents: systemBlocked ? ownerAgent : (value.ownerAgents || value.owner_agents || value.ownerAgent || value.owner_agent || value.nextAgent || value.next_agent || agentForPhase(phase)),
    ownerAgent,
    failureReason: nullIfEmpty(failureReason),
    recentDecisionPath: value.recentDecisionPath || value.recent_decision_path || null,
    recentIssuesPath: value.recentIssuesPath || value.recent_issues_path || null,
  };
}

async function auditStateSourceSplitIfNeeded({ repoRoot, jsonState, markdownRaw }) {
  if (!markdownRaw) return;
  const markdownState = parseWorkflowStateMarkdown({ content: markdownRaw, markdownPath: jsonState.path, jsonPath: jsonState.jsonPath });
  if (!hasCriticalStateDifference(jsonState, markdownState)) return;
  await appendAuditEvent({
    repoRoot,
    event: 'workflow_state_source_split',
    level: 'warn',
    phase: jsonState.phase,
    gate: jsonState.gate,
    data: {
      machine_source: summarizeStateForAudit(jsonState),
      markdown_source: summarizeStateForAudit(markdownState),
      diagnostic: 'workflow-state.md differs from workflow-state.json. CLI uses JSON as machine source; Markdown-only edits will not unblock /next.',
    },
    message: '检测到 workflow-state.md 与 workflow-state.json 不一致。',
  });
}

function hasCriticalStateDifference(a = {}, b = {}) {
  const keys = ['status', 'step', 'phase', 'gate', 'gateStatus', 'nextAgent', 'ownerAgents', 'failureReason'];
  return keys.some((key) => String(a[key] || '') !== String(b[key] || ''))
    || Number(a.round || 0) !== Number(b.round || 0)
    || Number(a.failureCount || 0) !== Number(b.failureCount || 0)
    || normalizeProductPrdEditMode(a.productPrdEditMode) !== normalizeProductPrdEditMode(b.productPrdEditMode);
}

function resolveProductPrdEditMode({ state, nextPhase, nextGateStatus, nextAgent, ownerAgents }) {
  const gateStatus = normalizeGateStatus(nextGateStatus);
  const phase = normalizePhase(nextPhase);
  const owners = String(ownerAgents || nextAgent || '').split(',').map((item) => item.trim());
  if (gateStatus === 'CHANGES_REQUESTED' && ['INTAKE', 'PRODUCT_REVIEW', 'PRD_REVIEW'].includes(phase) && owners.includes('product_agent')) return 'direct_edit';
  if (gateStatus === 'DRAFT' || gateStatus === 'APPROVED') return 'review_only';
  return normalizeProductPrdEditMode(state.productPrdEditMode);
}

function workflowStatusForGate({ phase, gateStatus, failureReason = null }) {
  const normalized = normalizeGateStatus(gateStatus);
  if (normalizePhase(phase) === 'ARCHIVE' && normalized === 'APPROVED') return 'DONE';
  if (normalized === 'BLOCKED') return isSystemFailureReason(failureReason) ? 'BLOCKED_BY_SYSTEM' : 'NEEDS_USER';
  if (normalized === 'CHANGES_REQUESTED' || normalized === 'RECHECK_REQUIRED') return 'NEEDS_FIX';
  if (normalized === 'DRAFT') return 'READY';
  return 'RUNNING';
}

function controllerStepForStatus({ status, gateStatus }) {
  const normalizedStatus = normalizeWorkflowStatus(status);
  if (normalizedStatus === 'BLOCKED_BY_SYSTEM') return 'SYSTEM_FIX';
  if (normalizedStatus === 'NEEDS_USER') return 'DECIDE';
  if (normalizedStatus === 'NEEDS_FIX') return normalizeGateStatus(gateStatus) === 'RECHECK_REQUIRED' ? 'VERIFY' : 'FIX';
  if (normalizedStatus === 'DONE') return 'DONE';
  return 'PLAN';
}

function failureReasonForStatus({ status, gateStatus }) {
  const normalizedStatus = normalizeWorkflowStatus(status);
  if (normalizedStatus === 'BLOCKED_BY_SYSTEM') return 'system_blocked';
  if (normalizedStatus === 'NEEDS_USER') return 'human_decision_required';
  if (normalizedStatus === 'NEEDS_FIX') return normalizeGateStatus(gateStatus) === 'RECHECK_REQUIRED' ? 'requires_recheck' : 'auto_fixable_issue';
  return null;
}

function primaryFailureReasonFromIssues(issues = []) {
  return issues.find((issue) => issue.failure_reason)?.failure_reason || null;
}

function shouldTreatAsSystemBlock({ failureCount, issues = [], humanDecisionIssues = [], autoFixableIssues = [], primaryFailureReason, gateSummary, state }) {
  const noHumanIssues = humanDecisionIssues.length === 0;
  const hasIssues = issues.length > 0;
  const verifierInconsistent = hasVerifierInconsistency(gateSummary);
  const stateSourceSplit = String(state.failureReason || '').trim().toLowerCase() === 'state_source_split';
  if (isSystemFailureReason(primaryFailureReason)) return { blocked: true, failureReason: primaryFailureReason };
  if (verifierInconsistent) return { blocked: true, failureReason: 'verifier_inconsistent' };
  if (stateSourceSplit) return { blocked: true, failureReason: 'state_source_split' };
  if (failureCount >= MAX_FAILURE_COUNT && noHumanIssues && hasIssues) return { blocked: true, failureReason: primaryFailureReason || 'repeated_failure' };
  if (noHumanIssues && hasIssues && autoFixableIssues.length > 0 && isSystemIssueCluster(autoFixableIssues)) {
    return { blocked: true, failureReason: primaryFailureReason || autoFixableIssues[0]?.failure_reason || 'engine_failed' };
  }
  return { blocked: false, failureReason: null };
}

function isSystemIssueCluster(issues = []) {
  return issues.some((issue) => isSystemFailureReason(issue.failure_reason))
    || issues.some((issue) => ['git_mutation_blocked', 'task_execution_failed'].includes(String(issue.issue_type || '').trim()));
}

function hasVerifierInconsistency(gateSummary = {}) {
  return (gateSummary.rows || []).some((row) => row.decisionFactors?.verifier_inconsistent);
}

function shouldRequireRecheck(previousIssues = []) {
  if (!previousIssues.length) return true;
  return previousIssues.some((issue) => {
    if (issue.decision_type === 'HUMAN_DECISION_REQUIRED') return true;
    return !STRUCTURAL_RECHECK_SKIP_TYPES.has(String(issue.issue_type || '').trim());
  });
}

function summarizeRepeatedIssues(issues = []) {
  const repeated = issues.filter((issue) => Number(issue.repeat_count || 1) > 1);
  if (!repeated.length) return '';
  return repeated
    .slice(0, 3)
    .map((issue) => `${issue.issue_type}/${issue.owner_agent}/${issue.decision_topic || issue.issue_signature} 连续 ${issue.repeat_count} 次`)
    .join('；');
}

function shouldAdvanceToPrdReview({ currentPhase, ownerAgents, issues = [] }) {
  if (normalizePhase(currentPhase) !== 'INTAKE') return false;
  const owners = String(ownerAgents || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!owners.length) return false;
  if (owners.includes('product_agent')) return false;
  if (!owners.every((owner) => PRD_REVIEW_OWNER_SET.has(owner))) return false;
  return issues.length > 0;
}

function matchValue(content, regex) {
  const match = String(content || '').match(regex);
  return match ? match[1].trim() : null;
}

function nullIfEmpty(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'none' || text.toLowerCase() === 'null' || text === 'N/A') return null;
  return text;
}

function normalizePhase(value) {
  return String(value || 'INTAKE').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeGateStatus(value) {
  return String(value || 'DRAFT').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeWorkflowStatus(value) {
  const normalized = String(value || 'READY').trim().toUpperCase().replace(/[ -]/g, '_');
  return ['READY', 'RUNNING', 'NEEDS_FIX', 'NEEDS_USER', 'BLOCKED_BY_SYSTEM', 'DONE'].includes(normalized) ? normalized : 'READY';
}

function normalizeProjectType(value) {
  const normalized = String(value || 'existing_refactor').trim().toLowerCase().replace(/[ -]/g, '_');
  return normalized === 'new_project' ? 'new_project' : 'existing_refactor';
}

function normalizeProductPrdEditMode(value) {
  const normalized = String(value || 'review_only').trim().toLowerCase().replace(/[ -]/g, '_');
  return normalized === 'direct_edit' ? 'direct_edit' : 'review_only';
}

function pendingText(gateStatus) {
  switch (normalizeGateStatus(gateStatus)) {
    case 'APPROVED': return '- 当前 Gate 已通过，可以进入下一阶段。';
    case 'RECHECK_REQUIRED': return '- 修复任务已通过基础检查，必须先启动复查 Agent，复查通过后才能进入下一阶段。';
    case 'CHANGES_REQUESTED': return '- 当前 Gate 未通过，但没有用户决策问题时会自动按 issue owner 分派责任 Agent 修复。';
    case 'BLOCKED': return '- 当前流程已阻塞；请结合 status/logs 判断这是用户决策阻塞还是系统阻塞。';
    default: return '- 当前 Gate 尚未执行，需要按下一步指令推进。';
  }
}

function gateForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW':
    case 'PRD_REVIEW': return 'PRD_GATE';
    case 'ARCHITECTURE_DESIGN':
    case 'ARCHITECTURE_REVIEW':
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'ARCHITECTURE_GATE';
    case 'UI_DESIGN': return 'UI_GATE';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN':
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'DESIGN_GATE';
    case 'IMPLEMENTATION':
    case 'TESTING':
    case 'REPAIR': return 'TEST_GATE';
    case 'PRODUCT_ACCEPTANCE': return 'PRODUCT_ACCEPTANCE_GATE';
    case 'USER_ACCEPTANCE': return 'USER_ACCEPTANCE_GATE';
    case 'ARCHIVE': return 'ARCHIVE_GATE';
    default: return 'NONE';
  }
}

function approvedNextPhase(phase, state) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW': return 'PRD_REVIEW';
    case 'PRD_REVIEW': return normalizeProjectType(state.projectType) === 'new_project' ? 'ARCHITECTURE_DESIGN' : 'ARCHITECTURE_IMPACT_REVIEW';
    case 'ARCHITECTURE_DESIGN': return 'ARCHITECTURE_REVIEW';
    case 'ARCHITECTURE_REVIEW': return 'UI_DESIGN';
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'UI_DESIGN';
    case 'UI_DESIGN': return 'DEVELOPMENT_DESIGN';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN': return 'DESIGN_REVIEW';
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'IMPLEMENTATION';
    case 'IMPLEMENTATION': return 'TESTING';
    case 'TESTING':
    case 'REPAIR': return 'PRODUCT_ACCEPTANCE';
    case 'PRODUCT_ACCEPTANCE': return 'USER_ACCEPTANCE';
    case 'USER_ACCEPTANCE': return 'ARCHIVE';
    default: return phase;
  }
}

function agentForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'PRD_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent';
    case 'ARCHITECTURE_DESIGN': return 'frontend_architect_agent,backend_architect_agent';
    case 'ARCHITECTURE_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent';
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent';
    case 'UI_DESIGN': return 'ui_agent';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN': return 'frontend_agent,backend_agent,test_agent';
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'product_agent,ui_agent,test_agent,frontend_architect_agent,backend_architect_agent,review_agent';
    case 'IMPLEMENTATION': return 'frontend_agent,backend_agent';
    case 'TESTING': return 'test_agent';
    case 'REPAIR': return 'repair_agent';
    case 'PRODUCT_ACCEPTANCE': return 'product_agent';
    case 'USER_ACCEPTANCE':
    case 'ARCHIVE': return 'brain_agent';
    default: return 'product_agent';
  }
}

function repairAgentForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW':
    case 'PRD_REVIEW': return 'product_agent';
    case 'ARCHITECTURE_DESIGN':
    case 'ARCHITECTURE_REVIEW':
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent';
    case 'UI_DESIGN': return 'ui_agent';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN':
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent,frontend_architect_agent,backend_architect_agent';
    case 'IMPLEMENTATION':
    case 'TESTING':
    case 'REPAIR': return 'frontend_agent,backend_agent,test_agent,repair_agent';
    case 'PRODUCT_ACCEPTANCE': return 'product_agent,frontend_agent,backend_agent,test_agent';
    default: return 'brain_agent';
  }
}

function recheckAgentForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW':
    case 'PRD_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent,review_agent';
    case 'ARCHITECTURE_DESIGN':
    case 'ARCHITECTURE_REVIEW':
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent,review_agent';
    case 'UI_DESIGN': return 'ui_agent,review_agent';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN':
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'product_agent,ui_agent,test_agent,frontend_architect_agent,backend_architect_agent,review_agent';
    case 'IMPLEMENTATION':
    case 'TESTING':
    case 'REPAIR': return 'test_agent,review_agent';
    case 'PRODUCT_ACCEPTANCE': return 'product_agent,test_agent';
    default: return 'brain_agent';
  }
}

function ownerAgentsFromIssues(issues) {
  const owners = issues.map((issue) => issue.owner_agent).filter(Boolean).filter((agent) => agent !== 'brain_agent');
  const unique = [...new Set(owners)];
  return unique.length ? unique.join(',') : null;
}
