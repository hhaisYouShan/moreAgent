import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readWorkflowState, writeWorkflowState } from './state.mjs';
import { appendConversationEntry, CONFIRMED_DECISIONS_PATH } from './conversation.mjs';
import { BEIJING_TIME_LABEL, BEIJING_TIME_ZONE, formatBeijingRunId, formatBeijingTimestamp } from './time.mjs';

const DECISION_TYPE = 'ISSUE_DECISION';

export function shouldUseBriefChat({ state }) {
  return normalizeGateStatus(state?.gateStatus) !== 'BLOCKED';
}

export async function decideCommand({ repoRoot, values = [], rawInput = null }) {
  const state = await readWorkflowState(repoRoot);
  const issueId = firstPositional(values);
  const decisionText = decisionTextFromValues(values);

  if (!issueId || !decisionText) {
    console.log('[agent] 用法：/decide ISSUE-PRD-xxxxxx "你的决策内容"');
    console.log('[agent] 示例：/decide ISSUE-PRD-123ABC "采用逐步替代策略"');
    process.exitCode = 1;
    return;
  }

  if (!state.recentIssuesPath) {
    console.log('[agent] 当前 workflow-state 没有 recent Issue 记录，无法写入结构化决策。');
    process.exitCode = 1;
    return;
  }

  const issues = await readIssuesFile({ repoRoot, issuesPath: state.recentIssuesPath });
  const openIssues = issues.filter((issue) => normalizeStatus(issue.status) === 'OPEN');
  const humanIssues = openIssues.filter((issue) => normalizeDecisionType(issue.decision_type) === 'HUMAN_DECISION_REQUIRED');
  const autoIssues = openIssues.filter((issue) => normalizeDecisionType(issue.decision_type) !== 'HUMAN_DECISION_REQUIRED');
  const targetIssue = humanIssues.find((issue) => issue.issue_id === issueId);

  if (!targetIssue) {
    console.log(`[agent] 没有找到待用户决策的开放 Issue：${issueId}`);
    console.log(`[agent] 当前待用户决策问题数：${humanIssues.length}`);
    for (const issue of humanIssues) console.log(`- ${issue.issue_id}: ${compact(issue.problem || issue.issue_type || issue.issue_signature)}`);
    process.exitCode = 1;
    return;
  }

  const record = await appendIssueDecision({ repoRoot, state, issue: targetIssue, decisionText, rawInput: rawInput || values.join(' ') });
  await appendConversationEntry({
    repoRoot,
    role: 'user',
    content: rawInput || `/decide ${issueId} ${decisionText}`,
    metadata: {
      command: 'decide',
      decision_id: record.id,
      issue_id: targetIssue.issue_id,
      issue_signature: targetIssue.issue_signature,
      decision_topic: record.decision_topic,
      gate: targetIssue.gate || state.gate,
      featureKey: state.featureKey,
      phase: state.phase,
      confirmed_at: record.confirmed_at,
    },
  });

  const decisions = await readConfirmedDecisions({ repoRoot });
  const unresolvedHumanIssues = humanIssues.filter((issue) => !hasMatchingDecision({ decisions, issue, state, extraRecord: record }));

  console.log('[agent] 已记录用户决策。');
  console.log(`- issue_id: ${targetIssue.issue_id}`);
  if (record.decision_topic) console.log(`- decision_topic: ${record.decision_topic}`);
  console.log(`- decision_id: ${record.id}`);
  console.log(`- confirmed_at: ${record.confirmed_at}`);
  console.log(`- 当前待用户决策问题数：${humanIssues.length}`);
  console.log(`- 已解决用户决策问题数：${humanIssues.length - unresolvedHumanIssues.length}`);
  console.log(`- 未解决用户决策问题数：${unresolvedHumanIssues.length}`);

  if (unresolvedHumanIssues.length > 0) {
    console.log('[agent] 仍有未确认问题：');
    for (const issue of unresolvedHumanIssues) console.log(`- ${issue.issue_id}: ${compact(issue.problem || issue.issue_type || issue.issue_signature)}`);
    return;
  }

  const ownerAgents = repairOwnerAgents({ state, autoIssues, humanIssues });
  const stateForWrite = shouldEnableDirectPrdEdit({ state, ownerAgents })
    ? { ...state, productPrdEditMode: 'direct_edit' }
    : state;

  await writeWorkflowState({
    state: stateForWrite,
    nextPhase: state.phase,
    nextRound: Number(state.round || 0),
    nextFailureCount: 0,
    nextGate: state.gate || gateForPhase(state.phase),
    nextGateStatus: 'CHANGES_REQUESTED',
    nextAgent: ownerAgents,
    ownerAgents,
    issuesPath: state.recentIssuesPath,
    decisionPath: state.recentDecisionPath,
    nextInstruction: `用户已通过 /decide 确认全部 HUMAN_DECISION_REQUIRED 问题。保留 ${autoIssues.length} 个 AUTO_FIXABLE 问题，下一轮回流给：${ownerAgents}。${stateForWrite.productPrdEditMode === 'direct_edit' ? 'PRD 修改模式已自动切换为 direct_edit。' : ''}请运行 npm run agent -- next --preview 或 /next。`,
  });

  console.log('[agent] 全部用户决策已确认，workflow-state 已解除 BLOCKED。');
  console.log('- Gate 状态：CHANGES_REQUESTED');
  console.log(`- Next Agent：${ownerAgents}`);
  if (stateForWrite.productPrdEditMode === 'direct_edit') console.log('- PRD 修改模式：direct_edit（已自动切换）');
  console.log('[agent] 下一步：/next 或 npm run agent -- next --preview');
}

async function appendIssueDecision({ repoRoot, state, issue, decisionText, rawInput }) {
  const confirmedAt = `${formatBeijingTimestamp()} ${BEIJING_TIME_LABEL}`;
  const decisionTopic = issue.decision_topic || decisionTopicForIssue(issue) || decisionTopicFromText(decisionText);
  const record = {
    id: `issue-decision-${issue.issue_id}-${formatBeijingRunId()}`,
    type: DECISION_TYPE,
    feature_key: state.featureKey,
    phase: state.phase,
    gate: issue.gate || state.gate,
    issue_id: issue.issue_id,
    issue_signature: issue.issue_signature,
    decision_topic: decisionTopic || null,
    issue_type: issue.issue_type,
    source_file: issue.source_file || null,
    target_files: issue.target_files || [],
    decision: decisionText,
    user_confirmed: true,
    confirmed_by: 'user',
    source: 'user',
    source_channel: 'agent_cli',
    status: 'CONFIRMED',
    confirmed_at: confirmedAt,
    timeZone: BEIJING_TIME_ZONE,
    timeLabel: BEIJING_TIME_LABEL,
    raw_user_input: rawInput,
    note: 'Written by scripts/agent-loop/cli.mjs from /decide or npm run agent -- decide. Semantic decision_topic lets future rounds reuse this decision without asking again.',
  };

  const filePath = path.join(repoRoot, CONFIRMED_DECISIONS_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });

  let parsed = { decisions: [] };
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    parsed = { decisions: [] };
  }

  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  decisions.push(record);
  await writeFile(filePath, `${JSON.stringify({ ...parsed, decisions }, null, 2)}\n`, 'utf8');
  return record;
}

async function readConfirmedDecisions({ repoRoot }) {
  try {
    const parsed = JSON.parse(await readFile(path.join(repoRoot, CONFIRMED_DECISIONS_PATH), 'utf8'));
    return Array.isArray(parsed.decisions) ? parsed.decisions : [];
  } catch {
    return [];
  }
}

async function readIssuesFile({ repoRoot, issuesPath }) {
  const absolutePath = path.join(repoRoot, issuesPath);
  if (!existsSync(absolutePath)) throw new Error(`Issue 文件不存在：${issuesPath}`);
  return parseIssuesMarkdown(await readFile(absolutePath, 'utf8'));
}

function parseIssuesMarkdown(content) {
  const text = String(content || '');
  const blocks = text.split(/\n##\s+/).slice(1);
  return blocks.map(parseIssueBlock).filter((issue) => issue.issue_id && issue.issue_signature);
}

function parseIssueBlock(block) {
  const lines = block.split('\n');
  const issueId = lines[0]?.trim() || '';
  const body = lines.slice(1).join('\n');
  return {
    issue_id: issueId,
    issue_signature: matchField(body, 'issue_signature'),
    decision_topic: matchField(body, 'decision_topic') || matchField(body, 'semantic_key'),
    repeat_count: Number(matchField(body, 'repeat_count') || 1),
    severity: matchField(body, 'severity'),
    decision_type: matchField(body, 'decision_type'),
    requires_user_decision: matchField(body, 'requires_user_decision'),
    owner_agent: matchField(body, 'owner_agent'),
    issue_type: matchField(body, 'issue_type'),
    gate: matchField(body, 'gate'),
    source_task: matchField(body, 'source_task'),
    source_agent: matchField(body, 'source_agent'),
    status: matchField(body, 'status') || 'OPEN',
    source_file: matchField(body, 'source_file'),
    target_files: parseInlineBackticks(matchLine(body, /^- target_files:\s*(.+)$/m)),
    problem: sectionText(body, 'Problem'),
    expected_fix: sectionText(body, 'Expected Fix'),
    verification: sectionText(body, 'Verification'),
  };
}

function hasMatchingDecision({ decisions, issue, state, extraRecord }) {
  const all = [...decisions, extraRecord].filter(Boolean);
  const issueTopic = issue.decision_topic || decisionTopicForIssue(issue);
  return all.some((record) => {
    if (normalizeKind(record.type) !== DECISION_TYPE) return false;
    if (normalizeStatus(record.status) !== 'CONFIRMED') return false;
    if (String(record.feature_key || '') !== String(state.featureKey || '')) return false;
    if (String(record.issue_id || '') === String(issue.issue_id || '')) return true;
    if (String(record.issue_signature || '') === String(issue.issue_signature || '')) return true;
    if (issueTopic && decisionTopicForRecord(record) === issueTopic) return true;
    return false;
  });
}

function repairOwnerAgents({ state, autoIssues, humanIssues }) {
  if (['PRD_GATE', 'NONE'].includes(normalizeKind(state.gate)) || ['INTAKE', 'PRODUCT_REVIEW', 'PRD_REVIEW'].includes(normalizePhase(state.phase))) return 'product_agent';

  const owners = [...autoIssues, ...humanIssues]
    .map((issue) => issue.owner_agent)
    .filter(Boolean)
    .filter((agent) => agent !== 'brain_agent');
  const uniqueOwners = [...new Set(owners)];
  if (uniqueOwners.length) return uniqueOwners.join(',');
  return repairAgentForPhase(state.phase);
}

function shouldEnableDirectPrdEdit({ state, ownerAgents }) {
  const phase = normalizePhase(state.phase);
  const owners = String(ownerAgents || '').split(',').map((item) => item.trim());
  return ['INTAKE', 'PRODUCT_REVIEW', 'PRD_REVIEW'].includes(phase) && owners.includes('product_agent');
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

function decisionTopicForIssue(issue) {
  return decisionTopicFromText([issue.decision_topic, issue.issue_type, issue.problem, issue.expected_fix, (issue.target_files || []).join(' ')].join(' '));
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
  if (text.includes('决策中心首页') || (text.includes('dashboard') && text.includes('首页'))) return 'prd.decision_center_homepage_scope';
  if (text.includes('optimized_resume_id') || text.includes('optimizedresume') || text.includes('resume_optimization_tasks')) return 'prd.optimized_resume_source';
  return null;
}

function decisionTextFromValues(values) {
  return values
    .slice(1)
    .filter((value) => !value.startsWith('--'))
    .join(' ')
    .trim();
}

function firstPositional(values) {
  return values.find((value) => !value.startsWith('--')) || '';
}

function matchField(body, field) {
  const regex = new RegExp('-\\s+' + escapeRegExp(field) + '\\s*[:：]\\s+`([^`]+)`', 'i');
  return body.match(regex)?.[1]?.trim() || '';
}

function matchLine(body, regex) {
  return body.match(regex)?.[1]?.trim() || '';
}

function parseInlineBackticks(value) {
  return [...String(value || '').matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function sectionText(body, title) {
  const regex = new RegExp(`###\\s+${escapeRegExp(title)}\\s+([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
  return body.match(regex)?.[1]?.trim() || '';
}

function normalizeGateStatus(value) {
  return String(value || 'DRAFT').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeDecisionType(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeStatus(value) {
  return String(value || 'OPEN').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeKind(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizePhase(value) {
  return String(value || 'INTAKE').trim().toUpperCase().replace(/[ -]/g, '_');
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
