#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readWorkflowState } from './state.mjs';
import { buildWorkflowRecommendation } from './recommendation.mjs';
import { BEIJING_TIME_LABEL, formatBeijingTimestamp } from './time.mjs';

export async function buildStatusCard(repoRoot = process.cwd(), options = {}) {
  // workflow-state.json is the only workflow source of truth.
  const state = options.state || await readWorkflowState(repoRoot);
  const phase = normalize(state.phase, 'INTAKE');
  const gateStatus = normalize(state.gateStatus, 'DRAFT');
  const gate = state.gate || gateForPhase(phase);
  const workflowStatus = normalizeWorkflowStatus(state.status || state.workflowStatus || 'READY');
  const step = normalizeStep(state.step || stepForStatus(workflowStatus));
  const nextAgent = state.nextAgent || agentForPhase(phase);
  const ownerAgents = state.ownerAgents || state.ownerAgent || nextAgent;
  const blocked = workflowStatus === 'NEEDS_USER' || workflowStatus === 'BLOCKED_BY_SYSTEM';
  const recommendation = buildWorkflowRecommendation({
    workflowStatus,
    controllerStep: step,
    humanIssueIds: state.humanIssueIds || state.human_issue_ids || [],
    ownerAgents,
    failureReason: state.failureReason,
  });

  return {
    featureKey: state.featureKey || 'bossresume-full-refactor',
    prdPath: state.prdPath || 'docs/prd/bossresume-full-refactor-prd.md',
    projectType: state.projectType || 'existing_refactor',
    productPrdEditMode: state.productPrdEditMode || 'review_only',
    currentTime: formatBeijingTimestamp(),
    timeLabel: BEIJING_TIME_LABEL,
    workflowStatus,
    step,
    phase,
    round: Number(state.round || 0),
    failureCount: Number(state.failureCount || 0),
    retryCount: Number(state.retryCount || state.failureCount || 0),
    failureReason: state.failureReason || 'N/A',
    gate,
    gateStatus,
    activeAgent: state.activeAgent || nextAgent,
    nextAgent,
    ownerAgents,
    recentDecisionPath: state.recentDecisionPath || 'N/A',
    recentIssuesPath: state.recentIssuesPath || 'N/A',
    blocked,
    nextAction: recommendation.message,
    recommendedAction: recommendation.action,
    recommendedCommand: recommendation.command,
    humanIssueIds: recommendation.issueIds || [],
    previewCommand: workflowStatus === 'READY' || workflowStatus === 'NEEDS_FIX' ? 'npm run agent -- next --preview' : null,
  };
}

export function renderStatusCard(card) {
  const lines = [
    'BossResume 多 Agent 当前状态',
    '',
    `当前时间：${card.currentTime}`,
    `时间规则：${card.timeLabel}`,
    `当前 PRD：${card.prdPath}`,
    `项目类型：${card.projectType}`,
    `PRD 修改模式：${card.productPrdEditMode}`,
    '',
    'Workflow 压缩状态：',
    `- status：${card.workflowStatus}`,
    `- step：${card.step}`,
    `- phase：${card.phase}`,
    `- active_agent：${card.activeAgent || 'N/A'}`,
    `- owner_agent：${card.ownerAgents || 'N/A'}`,
    `- failure_reason：${card.failureReason}`,
    `- retry_count：${card.retryCount}`,
    '',
    `当前 Gate：${card.gate} / ${card.gateStatus}`,
    `当前轮次：${card.round}`,
    `连续失败次数：${card.failureCount}`,
    `最近 Gate 决策：${card.recentDecisionPath}`,
    `最近 Issue 记录：${card.recentIssuesPath}`,
    `当前是否阻塞：${card.blocked ? '是' : '否'}`,
    '',
    `建议动作：${card.recommendedAction}`,
    `建议下一步：${card.nextAction}`,
    `推荐命令：${card.recommendedCommand || '无；先修复系统或检查状态。'}`,
  ];

  if (card.humanIssueIds?.length) lines.push(`待用户决策 Issue：${card.humanIssueIds.join(', ')}`);
  if (card.previewCommand) lines.push(`预览命令：${card.previewCommand}`);
  return lines.join('\n');
}

export function recommendedCommandFor({ workflowStatus, controllerStep, humanIssueIds = [], ownerAgents = [], failureReason = null } = {}) {
  return buildWorkflowRecommendation({ workflowStatus, controllerStep, humanIssueIds, ownerAgents, failureReason }).command;
}

export function nextActionFor({ workflowStatus, controllerStep, humanIssueIds = [], ownerAgents = [], failureReason = null } = {}) {
  return buildWorkflowRecommendation({ workflowStatus, controllerStep, humanIssueIds, ownerAgents, failureReason }).message;
}

function stepForStatus(status) {
  switch (normalizeWorkflowStatus(status)) {
    case 'BLOCKED_BY_SYSTEM': return 'SYSTEM_FIX';
    case 'NEEDS_USER': return 'DECIDE';
    case 'NEEDS_FIX': return 'FIX';
    case 'DONE': return 'COMPLETE';
    case 'RUNNING': return 'RUN';
    default: return 'PLAN';
  }
}

function gateForPhase(phase) {
  switch (phase) {
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

function agentForPhase(phase) {
  switch (phase) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW': return 'product_agent';
    case 'PRD_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent';
    case 'ARCHITECTURE_DESIGN': return 'frontend_architect_agent,backend_architect_agent';
    case 'ARCHITECTURE_REVIEW':
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
    default: return 'brain_agent';
  }
}

function normalize(value, fallback) {
  return String(value || fallback).trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeWorkflowStatus(value) {
  const normalized = normalize(value, 'READY');
  return ['READY', 'RUNNING', 'NEEDS_FIX', 'NEEDS_USER', 'BLOCKED_BY_SYSTEM', 'DONE'].includes(normalized) ? normalized : 'READY';
}

function normalizeStep(value) {
  return String(value || 'PLAN').trim().toUpperCase().replace(/[ -]/g, '_');
}

async function main() {
  const card = await buildStatusCard(process.cwd());
  console.log(renderStatusCard(card));
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error('[agent-status] 状态卡生成失败');
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}
