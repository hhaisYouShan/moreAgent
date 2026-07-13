#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { clearCurrentRunState } from './run-status.mjs';
import { hasCriticalWorkflowStateDifference, parseWorkflowStateMarkdown, readWorkflowState, writeWorkflowState } from './state.mjs';
import { formatBeijingTimestamp } from './time.mjs';

const root = process.cwd();
const flags = new Set(process.argv.slice(2));

main().catch((error) => {
  console.error('[state-reconcile] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  const before = await diagnoseStateSources(root);
  console.log(JSON.stringify(before, null, 2));

  const finalizationRequired = isReconciledStateSourceBlock(before.workflow);
  if (!before.splitDetected && !finalizationRequired) {
    console.log('[state-reconcile] 当前未检测到 state_source_split。');
    return;
  }
  if (!flags.has('--apply')) {
    console.log('[state-reconcile] 只读检查完成，未修改任何文件。');
    console.log('[state-reconcile] 应用命令：npm run agent:reconcile -- --apply --prune-worktrees --remove-orphan-worktrees');
    process.exitCode = 2;
    return;
  }

  const archiveDir = await archivePointers(before);
  const state = await readWorkflowState(root);

  // First write a single blocked state so the JSON, Markdown, and Round Context
  // no longer disagree while runtime pointers are being reset.
  await writeWorkflowState({
    state,
    nextPhase: 'INTAKE',
    nextRound: 0,
    nextFailureCount: Number(state.failureCount || 0),
    nextGate: 'NONE',
    nextGateStatus: 'DRAFT',
    nextAgent: 'gate_verifier',
    ownerAgents: 'gate_verifier',
    workflowStatus: 'BLOCKED_BY_SYSTEM',
    controllerStep: 'VERIFY',
    failureReason: 'state_source_split',
    issuesPath: path.relative(root, path.join(archiveDir, 'reconciliation.json')),
    decisionPath: null,
    nextInstruction: '处理 Reconcile Artifact 中的缺失 Artifact 和遗留 Worktree；M0 effectiveApproval=true 前禁止启动 Product Agent。',
    transitionMeta: { reason: 'state_source_reconciled', verifierInconsistent: true, issueCount: 1, systemIssueCount: 1 },
  });
  await clearCurrentRunState({
    repoRoot: root,
    prdPath: state.prdPath,
    featureKey: state.featureKey,
    message: `旧运行指针已保全到 ${path.relative(root, archiveDir)}；等待 M0 基线核查。`,
  });

  const reset = await diagnoseStateSources(root);
  const removals = [];
  if (flags.has('--remove-orphan-worktrees')) {
    for (const item of reset.worktrees.orphan) {
      const result = git(['worktree', 'remove', item.worktree]);
      removals.push({ path: item.worktree, exitCode: result.status ?? 1, stderr: result.stderr.trim() });
    }
  }
  let prune = null;
  if (flags.has('--prune-worktrees')) prune = git(['worktree', 'prune', '--expire', 'now']);

  const after = await diagnoseStateSources(root);

  console.log(`[state-reconcile] 旧运行态：${path.relative(root, archiveDir)}`);
  console.log('[state-reconcile] Current Run/Task/Event 已重置为 IDLE；M0 仍未通过。');
  for (const item of removals) console.log(`[state-reconcile] remove ${item.path}: exit=${item.exitCode}`);
  if (prune) console.log(`[state-reconcile] prune exit=${prune.status ?? 1}`);

  if (after.splitDetected) {
    await writeReconciliationEvidence({ archiveDir, before, after });
    await writeFile(path.join(archiveDir, 'after.json'), `${JSON.stringify(after, null, 2)}\n`, 'utf8');
    console.log(`[state-reconcile] 仍有冲突：${after.reasons.join(', ')}`);
    process.exitCode = 3;
    return;
  }

  await writeWorkflowState({
    state: await readWorkflowState(root),
    nextPhase: 'INTAKE',
    nextRound: 0,
    nextFailureCount: 0,
    nextGate: 'NONE',
    nextGateStatus: 'DRAFT',
    nextAgent: 'gate_verifier',
    ownerAgents: 'gate_verifier',
    workflowStatus: 'READY',
    controllerStep: 'PLAN',
    failureReason: null,
    issuesPath: path.relative(root, path.join(archiveDir, 'reconciliation.json')),
    decisionPath: null,
    nextInstruction: '运行态已对账；仅允许执行 M0 Baseline Checkpoint。effectiveApproval=true 前禁止启动 Product Agent。',
    transitionMeta: { reason: 'state_source_reconciled', verifierInconsistent: false, issueCount: 0, systemIssueCount: 0 },
  });

  const finalized = await diagnoseStateSources(root);
  await writeReconciliationEvidence({ archiveDir, before, after: finalized });
  await writeFile(path.join(archiveDir, 'after.json'), `${JSON.stringify(finalized, null, 2)}\n`, 'utf8');
  if (finalized.splitDetected) {
    console.log(`[state-reconcile] READY 写入后出现冲突：${finalized.reasons.join(', ')}`);
    process.exitCode = 3;
    return;
  }
  console.log('[state-reconcile] 运行指针和 Worktree 已对账；Workflow 已进入 READY，等待独立 M0。');
}

export async function diagnoseStateSources(repoRoot) {
  const workflow = await readJson('agent-loop-docs/process/workflow-state.json');
  const workflowMarkdown = await readText('agent-loop-docs/process/workflow-state.md');
  const roundContext = await readJson('agent-loop-docs/process/round-context.json');
  const run = await readJson('.agent-runs/current-run.json');
  const tasks = await readJson('.agent-runs/current-tasks.json');
  const eventsPath = path.join(repoRoot, '.agent-runs/current-events.jsonl');
  const references = collectReferences(run, tasks);
  const missingArtifacts = references.filter((value) => !existsSync(path.join(repoRoot, value)));
  const taskIds = new Set(Array.isArray(tasks?.tasks) ? tasks.tasks.map((item) => String(item?.taskId || '')).filter(Boolean) : []);
  const worktrees = inspectWorktrees(taskIds);
  const runExists = Boolean(run?.runId);
  const runActive = runExists && !['IDLE', 'FINISHED', 'DONE', 'FAILED', 'TIMEOUT', 'BLOCKED'].includes(String(run?.status || '').toUpperCase());
  const mismatch = runExists && (
    String(run?.phase || '') !== String(workflow?.phase || '')
    || Number(run?.workflowRound ?? run?.round ?? 0) !== Number(workflow?.round || 0)
    || (run?.workflowStatus && workflow?.workflowStatus && String(run.workflowStatus) !== String(workflow.workflowStatus))
  );
  const completedMissing = Array.isArray(tasks?.tasks)
    && tasks.tasks.some((item) => ['DONE', 'COMPLETED', 'FINISHED'].includes(String(item?.status || '').toUpperCase()))
    && missingArtifacts.length > 0;
  const markdownState = workflowMarkdown
    ? parseWorkflowStateMarkdown({
      content: workflowMarkdown,
      markdownPath: path.join(repoRoot, 'agent-loop-docs/process/workflow-state.md'),
      jsonPath: path.join(repoRoot, 'agent-loop-docs/process/workflow-state.json'),
    })
    : null;
  const markdownMismatch = !workflow || !markdownState || hasCriticalWorkflowStateDifference(workflow, markdownState);
  const roundContextState = normalizeRoundContext(roundContext);
  const roundMismatch = !workflow || !roundContextState || hasCriticalWorkflowStateDifference(workflow, roundContextState);
  const reasons = [
    markdownMismatch ? 'workflow_markdown_mismatch' : null,
    roundMismatch ? 'round_context_mismatch' : null,
    runActive ? 'unexpected_active_run' : null,
    mismatch ? 'workflow_run_mismatch' : null,
    completedMissing ? 'completed_tasks_missing_artifacts' : null,
    missingArtifacts.length ? 'missing_artifact_references' : null,
    worktrees.prunable.length ? 'prunable_worktrees' : null,
    worktrees.orphan.length ? 'orphan_worktrees' : null,
  ].filter(Boolean);

  return {
    checkedAt: formatBeijingTimestamp(),
    splitDetected: reasons.length > 0,
    workflow: summarizeWorkflow(workflow),
    markdownWorkflow: summarizeWorkflow(markdownState),
    roundContext: summarizeWorkflow(roundContextState),
    currentRun: summarizeRun(run),
    currentTaskCount: Array.isArray(tasks?.tasks) ? tasks.tasks.length : 0,
    currentEventsPresent: existsSync(eventsPath) && Boolean((await readFile(eventsPath, 'utf8')).trim()),
    artifactReferences: references,
    missingArtifacts,
    worktrees,
    reasons,
  };

  async function readJson(relativePath) {
    const filePath = path.join(repoRoot, relativePath);
    if (!existsSync(filePath)) return null;
    try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
  }

  async function readText(relativePath) {
    const filePath = path.join(repoRoot, relativePath);
    if (!existsSync(filePath)) return '';
    try { return await readFile(filePath, 'utf8'); } catch { return ''; }
  }

  function inspectWorktrees(currentTaskIds) {
    const result = git(['worktree', 'list', '--porcelain'], repoRoot);
    if (result.status !== 0) return { entries: [], prunable: [], orphan: [], error: result.stderr.trim() };
    const entries = parseWorktreePorcelain(result.stdout);
    const agentRoot = path.resolve(repoRoot, '.agent-worktrees');
    const orphan = entries.filter((entry) => {
      if (!entry.worktree) return false;
      const absolute = path.resolve(entry.worktree);
      return absolute.startsWith(`${agentRoot}${path.sep}`) && !currentTaskIds.has(path.basename(absolute));
    });
    return { entries, prunable: entries.filter((entry) => entry.prunable), orphan };
  }
}

async function archivePointers(diagnosis) {
  const folder = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(root, '.agent-runs', 'reconciled', folder);
  await mkdir(archiveDir, { recursive: true });
  for (const relativePath of ['.agent-runs/current-run.json', '.agent-runs/current-tasks.json', '.agent-runs/current-events.jsonl']) {
    const source = path.join(root, relativePath);
    if (existsSync(source)) await copyFile(source, path.join(archiveDir, path.basename(relativePath)));
  }
  await writeReconciliationEvidence({ archiveDir, before: diagnosis, after: null });
  return archiveDir;
}

async function writeReconciliationEvidence({ archiveDir, before, after }) {
  const reconciled = Boolean(after && !after.splitDetected);
  const artifact = {
    schema_version: '1.0',
    type: 'STATE_SOURCE_RECONCILIATION',
    status: reconciled ? 'RECONCILED' : 'SPLIT',
    failure_reason: reconciled ? null : 'state_source_split',
    created_at: formatBeijingTimestamp(),
    before,
    after,
    effective_m0_approval: false,
  };
  await writeFile(path.join(archiveDir, 'reconciliation.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function isReconciledStateSourceBlock(workflow) {
  return String(workflow?.workflowStatus || '').toUpperCase() === 'BLOCKED_BY_SYSTEM'
    && String(workflow?.failureReason || '').toLowerCase() === 'state_source_split';
}

function collectReferences(run, tasks) {
  const values = [
    run?.decisionPath, run?.issuesPath, run?.completionStatusPath, run?.runDir,
    ...(Array.isArray(tasks?.tasks) ? tasks.tasks.flatMap((item) => [item?.log, item?.statusFile, item?.script, item?.gateResult, ...(item?.outputs || [])]) : []),
  ];
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function parseWorktreePorcelain(text) {
  const entries = [];
  let item = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (Object.keys(item).length) entries.push(item);
      item = {};
      continue;
    }
    const [key, ...rest] = line.split(' ');
    item[key] = rest.join(' ') || true;
  }
  if (Object.keys(item).length) entries.push(item);
  return entries;
}

function summarizeWorkflow(value) {
  if (!value) return null;
  return { workflowStatus: value.workflowStatus || value.status, step: value.step, phase: value.phase, round: value.round, gate: value.gate, gateStatus: value.gateStatus, failureReason: value.failureReason };
}

function summarizeRun(value) {
  if (!value) return null;
  return { runId: value.runId, status: value.status, phase: value.phase, round: value.workflowRound ?? value.round, gate: value.gate, gateStatus: value.gateStatus, workflowStatus: value.workflowStatus, decisionPath: value.decisionPath, issuesPath: value.issuesPath };
}

function normalizeRoundContext(value) {
  if (!value) return null;
  return {
    ...value,
    featureKey: value.feature_key,
    prdPath: value.prd_path,
    productPrdEditMode: value.product_prd_edit_mode,
    workflowStatus: value.workflowStatus || value.status,
    gateStatus: value.gateStatus || value.gate_status,
    nextAgent: value.nextAgent || value.active_agent,
    ownerAgents: value.ownerAgents || value.owner_agent,
    failureReason: value.failureReason || value.failure_reason,
    round: value.round ?? value.workflow_round,
    failureCount: value.failureCount ?? value.retry_count,
    retryCount: value.retryCount ?? value.retry_count,
  };
}

function git(args, cwd = root) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}
