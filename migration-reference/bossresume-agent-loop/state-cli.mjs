#!/usr/bin/env node
import process from 'node:process';
import { readWorkflowState, writeWorkflowState, reconcileWorkflowStateFromMarkdown } from './state.mjs';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

main().catch((error) => {
  console.error('[agent-state] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  const state = await readWorkflowState(repoRoot);
  const prdEditMode = readOption('--prd-edit-mode');
  const projectType = readOption('--project-type');
  const reconcileMarkdown = hasFlag('--reconcile-markdown');

  if (reconcileMarkdown) {
    const result = await reconcileWorkflowStateFromMarkdown({ repoRoot, actor: 'state-cli', reason: 'manual_reconcile_markdown' });
    if (result.reconciled) {
      console.log('[agent-state] 已修复 workflow-state.md / workflow-state.json / round-context.json 状态源分裂。');
    } else {
      console.log(`[agent-state] 无需修复：${result.reason}`);
    }
    return;
  }

  if (!prdEditMode && !projectType) {
    console.log('[agent-state] no change requested');
    console.log('Usage: npm run agent:state -- --prd-edit-mode=direct_edit');
    console.log('       npm run agent:state -- --prd-edit-mode=review_only');
    console.log('       npm run agent:state -- --project-type=existing_refactor');
    console.log('       npm run agent:state -- --project-type=new_project');
    console.log('       npm run agent:state -- --reconcile-markdown');
    return;
  }

  const nextState = {
    ...state,
    productPrdEditMode: prdEditMode ? normalizePrdEditMode(prdEditMode) : state.productPrdEditMode,
    projectType: projectType ? normalizeProjectType(projectType) : state.projectType,
  };

  await writeWorkflowState({
    state: nextState,
    nextPhase: state.phase,
    nextRound: state.round,
    nextFailureCount: state.failureCount || 0,
    nextGate: state.gate,
    nextGateStatus: state.gateStatus,
    nextAgent: state.nextAgent || state.ownerAgents || 'product_agent',
    ownerAgents: state.ownerAgents || state.nextAgent || 'product_agent',
    issuesPath: state.recentIssuesPath,
    decisionPath: state.recentDecisionPath,
    nextInstruction: renderInstruction({ before: state, after: nextState }),
    transitionMeta: { reason: 'state_cli_update' },
  });

  console.log('[agent-state] updated agent-loop-docs/process/workflow-state.md/json/round-context.json');
  console.log(`- PRD 修改模式: ${state.productPrdEditMode} -> ${nextState.productPrdEditMode}`);
  console.log(`- 项目类型: ${state.projectType} -> ${nextState.projectType}`);
}

function renderInstruction({ before, after }) {
  const changes = [];
  if (before.productPrdEditMode !== after.productPrdEditMode) changes.push(`PRD 修改模式切换为 ${after.productPrdEditMode}`);
  if (before.projectType !== after.projectType) changes.push(`项目类型切换为 ${after.projectType}`);
  return `Workflow state updated: ${changes.join('；') || '无字段变化'}。继续按当前阶段 ${before.phase} 和 Gate 状态 ${before.gateStatus} 执行。`;
}

function readOption(name) {
  const prefix = `${name}=`;
  const item = args.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes(name);
}

function normalizePrdEditMode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[ -]/g, '_');
  if (!['review_only', 'direct_edit'].includes(normalized)) throw new Error(`Unsupported --prd-edit-mode: ${value}`);
  return normalized;
}

function normalizeProjectType(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[ -]/g, '_');
  if (!['existing_refactor', 'new_project'].includes(normalized)) throw new Error(`Unsupported --project-type: ${value}`);
  return normalized;
}
