#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { readWorkflowState, writeWorkflowState, decideNextState } from './state.mjs';
import { planTasks } from './planner.mjs';
import { ensureWorktree } from './worktree.mjs';
import { prepareCodexTaskScript } from './codex-runner.mjs';
import { attachTmux, ensureTmuxSession, runInTmuxWindow, waitForStatusFiles } from './tmux-runner.mjs';
import { runInWarpWindow } from './warp-runner.mjs';
import { summarizeGate } from './gate.mjs';
import { annotateIssueRepeats, buildIssuesFromGateSummary, parseIssuesMarkdown } from './issue-router.mjs';
import { runPreflight, formatPreflight } from './preflight.mjs';
import {
  syncTaskOutputsToRepo,
  persistGateDecision,
  persistIssues,
  persistRunDashboard,
  persistCompletionStatus,
  persistArchiveSnapshot,
} from './persistence.mjs';
import { collectScopeViolations } from './scope-guard.mjs';
import {
  collectCodeIntegration,
  shouldPreloadIntegratedCode,
  syncApprovedCodeChangesToIntegrationBranch,
  syncApprovedCodeChangesToRepo,
  syncRootCodeChangesToWorktree,
} from './code-sync.mjs';
import { selfCheckPolicyText } from './self-check-policy.mjs';
import { formatBeijingRunId } from './time.mjs';
import {
  appendRunEvent,
  markTaskCompleted,
  markTaskLaunched,
  writeGateChecking,
  writeRunFailed,
  writeRunFinished,
  writeRunStarted,
  writeRunStep,
} from './run-status.mjs';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const repoRoot = process.cwd();
const dryRun = args.has('--dry-run');
const attach = args.has('--attach');
const freshWorktree = args.has('--fresh-worktree') || args.has('--fresh-worktrees');
const phase = readOption('--phase');
const runner = normalizeRunner(readOption('--runner') || process.env.AGENT_LOOP_RUNNER || 'warp');
const engine = normalizeEngine(readOption('--engine') || process.env.AGENT_LOOP_ENGINE || 'opencode');
const loopMode = normalizeMode(readOption('--mode') || process.env.AGENT_LOOP_MODE || 'single');
const explicitMaxLoops = readNumberOption('--max-loops', null);
const maxLoops = resolveMaxLoops({ mode: loopMode, explicitMaxLoops });
const taskTimeoutMs = readTaskTimeoutMs();
const model = resolveModel(engine);
const baseBranch = process.env.AGENT_LOOP_BASE_BRANCH;
const runId = formatBeijingRunId(new Date());
const sessionName = process.env.AGENT_LOOP_TMUX_SESSION || `boss-agent-loop-${runId.slice(11, 19)}`;
const runDir = path.join(repoRoot, '.agent-runs', runId);
let activeRunStarted = false;

main().catch(async (error) => {
  if (activeRunStarted) {
    const status = /Timed out waiting/i.test(error?.message || '') ? 'TIMEOUT' : 'FAILED';
    await writeRunFailed({ repoRoot, status, error });
  }
  console.error('[agent-loop] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

process.once('SIGINT', () => handleAbortSignal('SIGINT'));
process.once('SIGTERM', () => handleAbortSignal('SIGTERM'));

async function main() {
  assertLoopModeAllowed(loopMode);

  const preflight = runPreflight({ repoRoot, requireTmux: runner === 'tmux', requireWarp: runner === 'warp', requireCodex: engine === 'codex', requireOpenCode: engine === 'opencode' });
  console.log('[agent-loop] preflight');
  console.log(formatPreflight(preflight));

  if (!dryRun && !preflight.ok) throw new Error('Preflight failed. Install missing tools before running real agent loop.');

  let state = await readWorkflowState(repoRoot);

  const workflowStatus = normalizeWorkflowStatus(state.status || state.workflowStatus);

  if (workflowStatus === 'BLOCKED_BY_SYSTEM') {
    console.error('[agent-loop] 当前属于系统阻塞，不需要用户业务决策。不要执行 chat/decide/next。请先修复 Agent Loop 控制面问题后执行 verify-current。');
    process.exitCode = 1;
    return;
  }

  if (workflowStatus === 'NEEDS_USER' && !args.has('--force-blocked-summary')) {
    console.error('[agent-loop] 当前需要用户决策。请运行 npm run agent -- chat，或使用 decide 记录明确决策。');
    process.exitCode = 1;
    return;
  }

  if (normalizeGateStatus(state.gateStatus) === 'BLOCKED' && !['NEEDS_USER', 'BLOCKED_BY_SYSTEM'].includes(workflowStatus)) {
    console.error('[agent-loop] workflow status 与 gateStatus 不一致：gateStatus=BLOCKED，但 workflowStatus 不是 NEEDS_USER/BLOCKED_BY_SYSTEM。请先检查状态源并修复后执行 verify-current。');
    process.exitCode = 1;
    return;
  }

  for (let iteration = 1; iteration <= maxLoops; iteration += 1) {
    const tasks = planTasks(state, { phase: iteration === 1 ? phase : null });
    printPlan({ state, tasks, iteration });

    if (!tasks.length) {
      console.log('[agent-loop] 当前没有可执行任务。');
      return;
    }

    if (dryRun) {
      console.log('\n[agent-loop] dry-run complete. No worktree, terminal window, or agent process was created.');
      return;
    }

    const iterationDir = path.join(runDir, `iteration-${iteration}`);
    await mkdir(iterationDir, { recursive: true });
    await writeRunStarted({ repoRoot, runId, runDir: iterationDir, iteration, state, tasks, mode: loopMode, maxLoops });
    activeRunStarted = true;
    if (runner === 'tmux') ensureTmuxSession(sessionName);

    const statusFiles = [];
    const launchedTasks = [];
    const worktrees = new Map();

    for (const task of tasks) {
      await writeRunStep({ repoRoot, step: 'CREATING_WORKTREE', message: `正在准备 ${task.displayName} 的 worktree。` });
      const worktree = await ensureWorktree({ repoRoot, task, baseBranch, fresh: freshWorktree });
      worktrees.set(task.id, worktree);

      if (shouldPreloadIntegratedCode(task)) {
        task.preloadedFiles = await syncRootCodeChangesToWorktree({ repoRoot, worktreePath: worktree.worktreePath });
        if (task.preloadedFiles.length) console.log(`[agent-loop] preloaded integrated code into ${task.displayName}: ${task.preloadedFiles.join(', ')}`);
      }

      const agentPrompt = await readFile(path.join(repoRoot, task.agentPromptPath), 'utf8');
      const prompt = renderTaskPrompt({ task, state, agentPrompt });
      const script = await prepareCodexTaskScript({ repoRoot, runDir: iterationDir, task, worktreePath: worktree.worktreePath, promptContent: prompt, model, engine });

      statusFiles.push(script.statusPath);
      launchedTasks.push({ task, worktree, script });
      await writeRunStep({ repoRoot, step: 'LAUNCHING_AGENT', message: `正在启动 ${task.displayName}。` });
      const command = `bash ${shellQuote(script.scriptPath)}; echo; echo '[agent-loop] 子 Agent 已结束。按任意键关闭该窗口。'; read -n 1`;
      if (runner === 'tmux') runInTmuxWindow({ sessionName, windowName: task.windowName, command });
      else await runInWarpWindow({ runDir: iterationDir, windowName: task.windowName, command });
      await markTaskLaunched({ repoRoot, task, script });
    }

    if (runner === 'tmux') {
      console.log(`\n[agent-loop] tmux session: ${sessionName}`);
      console.log(`[agent-loop] attach with: tmux attach -t ${sessionName}`);
    } else {
      console.log(`\n[agent-loop] Warp runner launched ${tasks.length} window(s).`);
      console.log(`[agent-loop] launch scripts: ${path.relative(repoRoot, path.join(iterationDir, 'warp-windows'))}`);
    }

    printLaunchedTaskHints({ launchedTasks, iterationDir });

    if (attach && iteration === 1 && runner === 'tmux') attachTmux(sessionName);
    if (attach && iteration === 1 && runner === 'warp') console.log('[agent-loop] --attach is ignored for Warp runner; Warp windows are opened by macOS.');

    console.log(`[agent-loop] 子 Agent 运行中。可在主控台输入 /jobs 查看状态，/logs 查看结构化事件，/logs raw 查看原始日志。Timeout: ${formatDurationMs(taskTimeoutMs)}.`);
    await writeRunStep({ repoRoot, step: 'WAITING_STATUS_JSON', message: '正在等待子 Agent 写出 status.json。' });
    const statuses = await waitForStatusFiles(statusFiles, {
      timeoutMs: taskTimeoutMs,
      onStatus: async (status) => markTaskCompleted({ repoRoot, status }),
    });
    await writeGateChecking({ repoRoot });

    const scopeViolations = collectScopeViolations({ tasks, worktrees });
    const codeIntegration = collectCodeIntegration({ tasks, worktrees });
    const rawGateSummary = await summarizeGate({ tasks, worktrees, statuses, scopeViolations, codeIntegration, state, runId, repoRoot });
    const gate = gateNameForState(state);
    await writeRunStep({ repoRoot, step: 'SYNCING_OUTPUTS', message: '正在同步子 Agent 产物。' });
    const outputFiles = await syncTaskOutputsToRepo({ repoRoot, tasks, worktrees });

    let integrationBranch = null;
    let effectiveGateSummary = rawGateSummary;
    let integratedCodeFiles = [];

    if (rawGateSummary.status === 'APPROVED') {
      integrationBranch = await syncApprovedCodeChangesToIntegrationBranch({ repoRoot, tasks, worktrees, codeIntegration, featureKey: state.featureKey });
      effectiveGateSummary = applyIntegrationBranchGateResult({ gateSummary: rawGateSummary, integrationBranch, state });
      if (effectiveGateSummary.status === 'APPROVED') {
        integratedCodeFiles = await syncApprovedCodeChangesToRepo({ repoRoot, tasks, worktrees, codeIntegration });
      }
    }

    const copiedOutputs = unique([...outputFiles, ...integratedCodeFiles]);
    const previousIssues = await readPreviousIssues({ repoRoot, state });
    const rawIssues = buildIssuesFromGateSummary(effectiveGateSummary, { gate });
    const issues = annotateIssueRepeats(rawIssues, previousIssues);
    const decisionPath = await persistGateDecision({ repoRoot, featureKey: state.featureKey, round: Number(state.round || 0) + 1, gate, gateSummary: effectiveGateSummary, copiedOutputs, runDir: iterationDir });
    const issuesPath = await persistIssues({ repoRoot, featureKey: state.featureKey, round: Number(state.round || 0) + 1, gate, issues });
    const archivePath = effectiveGateSummary.status === 'APPROVED' && state.phase === 'ARCHIVE' ? await persistArchiveSnapshot({ repoRoot, featureKey: state.featureKey, round: Number(state.round || 0) + 1, state, decisionPath, issuesPath, copiedOutputs }) : null;

    const next = decideNextState({ state, gateSummary: effectiveGateSummary, issues, previousIssues });
    const postState = {
      ...state,
      phase: next.nextPhase,
      round: next.nextRound,
      failureCount: next.nextFailureCount,
      gate: next.nextGate,
      gateStatus: next.nextGateStatus,
      nextAgent: next.nextAgent,
      ownerAgents: next.ownerAgents,
    };

    await writeRunStep({ repoRoot, step: 'UPDATING_STATE', message: '正在更新 workflow-state 和看板。' });
    await writeWorkflowState({
      state,
      ...next,
      issuesPath,
      decisionPath,
      archivePath,
      transitionMeta: {
        reason: 'orchestrator_gate_result',
        issueCount: issues.length,
        humanIssueCount: issues.filter((issue) => issue.decision_type === 'HUMAN_DECISION_REQUIRED').length,
        autoIssueCount: issues.filter((issue) => issue.decision_type === 'AUTO_FIXABLE').length,
        verifierInconsistent: hasVerifierInconsistency(effectiveGateSummary, issues),
      },
    });
    const runtimeStatus = next.nextGateStatus === 'BLOCKED' ? 'BLOCKED' : effectiveGateSummary.status === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED';

    await persistRunDashboard({ repoRoot, state: postState, tasks, gateSummary: effectiveGateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir: iterationDir });
    const completionStatusPath = await persistCompletionStatus({ repoRoot, state: postState, tasks, gate, gateSummary: effectiveGateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir: iterationDir });

    await writeFile(path.join(iterationDir, 'summary.json'), JSON.stringify({ state, next, tasks, statuses, gateSummary: effectiveGateSummary, rawGateSummary, issues, previousIssues, copiedOutputs, codeIntegration: Object.fromEntries(codeIntegration), integrationBranch, decisionPath, issuesPath, archivePath, completionStatusPath, mode: loopMode, maxLoops }, null, 2), 'utf8');
    await writeRunFinished({ repoRoot, status: runtimeStatus, gateSummary: effectiveGateSummary, issues, decisionPath, issuesPath, completionStatusPath });
    await appendRunEvent({ repoRoot, type: 'iteration_finished', status: runtimeStatus, step: 'FINISHED', message: `第 ${iteration} 轮完成，流程状态：${runtimeStatus}。`, data: { issueCount: issues.length, repeatedIssueCount: issues.filter((issue) => Number(issue.repeat_count || 1) > 1).length, verifierInconsistent: hasVerifierInconsistency(effectiveGateSummary, issues) } });

    printGateSummary({ gateSummary: effectiveGateSummary, runtimeStatus, issues, decisionPath, issuesPath, completionStatusPath, archivePath, iterationDir });

    if (integratedCodeFiles.length) {
      console.log('\n[agent-loop] integrated code files');
      console.log(integratedCodeFiles.map((file) => `- ${file}`).join('\n'));
    }

    if (integrationBranch?.branch) {
      console.log('\n[agent-loop] integration branch');
      console.log(`- branch: ${integrationBranch.branch}`);
      console.log(`- worktree: ${integrationBranch.worktreePath}`);
      if (integrationBranch.mergedBranches?.length) console.log(`- merged branches: ${integrationBranch.mergedBranches.join(', ')}`);
      if (integrationBranch.conflicts?.length) console.log(`- conflicts: ${integrationBranch.conflicts.map(formatIntegrationIssue).join('; ')}`);
      if (integrationBranch.skipped?.length) console.log(`- skipped: ${integrationBranch.skipped.map(formatIntegrationIssue).join('; ')}`);
    }

    if (next.nextGateStatus === 'BLOCKED') {
      if (next.workflowStatus === 'BLOCKED_BY_SYSTEM') console.log('[agent-loop] 当前属于系统阻塞，不需要用户决策。停止自动推进，请先运行 npm run agent -- logs。');
      else console.log('[agent-loop] 当前需要用户决策或连续失败达到上限。停止自动推进，请运行 npm run agent -- chat。');
      break;
    }

    if (runtimeStatus === 'APPROVED') console.log('[agent-loop] APPROVED. Workflow-state decides whether to advance or run a required recheck.');
    else console.log('[agent-loop] CHANGES_REQUESTED. 当前问题可自动修复，下一轮会分派给责任 Agent。');

    if (iteration >= maxLoops) break;
    if (loopMode !== 'auto') break;
    state = await readWorkflowState(repoRoot);
  }

  activeRunStarted = false;
}

async function handleAbortSignal(signal) {
  if (activeRunStarted) await writeRunFailed({ repoRoot, status: 'ABORTED', reason: `收到 ${signal}，Agent Loop 已中断。` });
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

function printPlan({ state, tasks, iteration }) {
  console.log('\n[agent-loop] plan');
  console.log(`- iteration: ${iteration}`);
  console.log(`- feature: ${state.featureKey}`);
  console.log(`- prd: ${state.prdPath}`);
  console.log(`- project type: ${state.projectType}`);
  console.log(`- prd edit mode: ${state.productPrdEditMode}`);
  console.log(`- current phase: ${state.phase}`);
  console.log(`- gate: ${state.gate} / ${state.gateStatus}`);
  console.log(`- consecutive failures: ${state.failureCount || 0}`);
  if (state.nextAgent) console.log(`- next agent: ${state.nextAgent}`);
  console.log(`- mode: ${loopMode}`);
  console.log(`- runner: ${runner}`);
  console.log(`- engine: ${engine}`);
  console.log(`- model: ${model}`);
  console.log(`- max loops: ${maxLoops}`);
  console.log(`- fresh worktree: ${freshWorktree ? 'yes' : 'no'}`);
  console.log(`- task timeout: ${formatDurationMs(taskTimeoutMs)}`);
  if (runner === 'tmux') console.log(`- tmux session: ${sessionName}`);
  if (runner === 'warp') console.log('- Warp windows: one per Agent task');
  console.log('- tasks:');
  for (const task of tasks) {
    console.log(`  - ${task.displayName}`);
    console.log(`    id: ${task.id}`);
    console.log(`    responsibility: ${task.responsibility}`);
    console.log(`    worktree: .agent-worktrees/${task.id}`);
    console.log(`    prompt: ${task.agentPromptPath}`);
    if (task.inputFiles?.length) console.log(`    extra inputs: ${task.inputFiles.join(', ')}`);
    if (task.inputSearchPatterns?.length) console.log(`    input search patterns: ${task.inputSearchPatterns.join(', ')}`);
    console.log(`    outputs: ${task.outputFiles.join(', ')}`);
    console.log(`    gate result: ${task.gateResultFile}`);
    if (task.editableFiles?.length) console.log(`    editable: ${task.editableFiles.join(', ')}`);
    if (task.allowedChangePatterns?.length) console.log(`    allowed change patterns: ${task.allowedChangePatterns.join(', ')}`);
  }
}

function printLaunchedTaskHints({ launchedTasks, iterationDir }) {
  console.log('\n[agent-loop] launched tasks');
  console.log(`- run dir: ${path.relative(repoRoot, iterationDir)}`);
  console.log('- 查看状态：/jobs');
  console.log('- 查看结构化事件：/logs');
  console.log('- 查看原始日志：/logs raw');
  for (const { task, script } of launchedTasks) {
    console.log(`  - ${task.displayName}`);
    console.log(`    log: ${path.relative(repoRoot, script.logPath)}`);
    console.log(`    status: ${path.relative(repoRoot, script.statusPath)}`);
  }
}

function renderTaskPrompt({ task, state, agentPrompt }) {
  const requiredInputs = unique([
    'AGENTS.md',
    'docs/README.md',
    'agent-loop-docs/process/workflow-state.md',
    'agent-loop-docs/process/workflow-state.json',
    'agent-loop-docs/process/round-context.json',
    'agent-loop-docs/process/audit-events.jsonl',
    'agent-loop-docs/process/agent-registry.md',
    'agent-loop-docs/process/gate-matrix.md',
    'agent-loop-docs/process/brain-loop-protocol.md',
    'agent-loop-docs/process/prd-review-standard.md',
    'agent-loop-docs/process/completion-status.md',
    state.prdPath || 'docs/prd/bossresume-full-refactor-prd.md',
    'agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md',
  ]);
  const extraInputs = task.inputFiles?.length ? `\nAdditional exact input files for this task:\n\n${task.inputFiles.map((file) => `- ${file}`).join('\n')}\n` : '';
  const inputSearchPatterns = task.inputSearchPatterns?.length ? `\n## Input Search Patterns\n\nFind and read the latest matching files before writing the output. Use the newest round/time when multiple files match:\n\n${task.inputSearchPatterns.map((pattern) => `- ${pattern}`).join('\n')}\n` : '';
  const preloadedFiles = task.preloadedFiles?.length ? `\n## Preloaded Integrated Code\n\nThese code files were preloaded from the main workspace for test/acceptance context. Do not modify them unless this task explicitly allows code changes:\n\n${task.preloadedFiles.map((file) => `- ${file}`).join('\n')}\n` : '';
  const editableFiles = task.editableFiles?.length ? `\n## Editable Files\n\nYou may edit these concrete files, but they are not Self Check report files:\n\n${task.editableFiles.map((file) => `- ${file}`).join('\n')}\n` : '';
  const allowedChangePatterns = task.allowedChangePatterns?.length ? `\n## Allowed Change Patterns\n\nThese are glob-style authorization patterns, not required existing paths. You may only change code/config files matching these patterns:\n\n${task.allowedChangePatterns.map((pattern) => `- ${pattern}`).join('\n')}\n` : '';
  const gateResult = `\n## Structured Gate Result\n\nCreate or update exactly this JSON file:\n\n- ${task.gateResultFile}\n\nRequired JSON fields:\n\n{\n  "task_id": "${task.id}",\n  "agent": "${task.agent}",\n  "phase": "${task.phase}",\n  "conclusion": "PASS | CHANGES_REQUESTED | BLOCKED",\n  "issues": [\n    {\n      "severity": "BLOCKER | MAJOR",\n      "status": "OPEN | CLOSED",\n      "decision_type": "AUTO_FIXABLE | HUMAN_DECISION_REQUIRED",\n      "owner_agent": "${task.agent}",\n      "issue_type": "specific_issue_type",\n      "target_files": [],\n      "problem": "Current unresolved problem only",\n      "expected_fix": "What should be changed",\n      "verification": "How the Gate can verify the fix"\n    }\n  ],\n  "open_questions": [],\n  "owner_agents": [],\n  "target_files": [],\n  "verification": "How the Gate can verify this result"\n}\n\nRules: Gate only trusts current OPEN items in issues[] and open_questions[]. Markdown body text is explanatory only and must not be used to carry current blockers. Closed or historical issues must use status CLOSED/RESOLVED/DONE/FIXED. If an OPEN item lacks decision_type, Gate treats that as AUTO_FIXABLE schema error and routes it back to the owner Agent.\n`;

  return `${agentPrompt}\n\n---\n\n# Runtime Task\n\n- display name: ${task.displayName}\n- responsibility: ${task.responsibility}\n- feature-key: ${state.featureKey}\n- PRD path: ${state.prdPath}\n- project type: ${state.projectType}\n- PRD edit mode: ${state.productPrdEditMode}\n- current phase: ${state.phase}\n- current gate: ${state.gate}\n- gate status: ${state.gateStatus}\n- consecutive failures: ${state.failureCount || 0}\n- task id: ${task.id}\n- task title: ${task.title}\n- round: ${task.round}\n- allow business code changes: ${task.allowCodeChanges ? 'yes' : 'no'}\n\n## Required Inputs\n\nRead these files first:\n\n${requiredInputs.map((file) => `- ${file}`).join('\n')}\n${extraInputs}${inputSearchPatterns}\n## Required Outputs\n\nCreate or update exactly these Self Check report file(s):\n\n${task.outputFiles.map((file) => `- ${file}`).join('\n')}\n${gateResult}${preloadedFiles}${editableFiles}${allowedChangePatterns}\n## Phase Self Check Policy\n\n${selfCheckPolicyText(task.phase, { taskKind: task.taskKind || task.task_kind || task.kind, task })}\n\n## Execution Rules\n\n1. Brain Agent has no code-writing permission. If you are brain_agent, do not modify business code.\n2. Do not modify business code unless allow business code changes is yes.\n3. If allowed change patterns are listed, they are authorization patterns only and must not be treated as required existing paths.\n4. If a requirement is unclear, only mark HUMAN_DECISION_REQUIRED when it requires user business/product/architecture decision. Format, missing output, missing Self Check, or gate_result problems are AUTO_FIXABLE and must be fixed by the responsible Agent.\n5. End every output file with a Self Check section.\n6. Self Check must include: 结论：PASS/FAIL/BLOCKED and 是否允许进入下一阶段：是/否. Markdown bold like **结论** is allowed and will be parsed.\n7. Keep the change minimal and scoped to this task.\n8. If this task was dispatched from agent-loop-docs/issues, fix only issues assigned to ${task.agent}.\n9. If editable files or allowed change patterns are listed, summarize every edit in the required Self Check report file.\n10. Implementation must follow approved design documents and be executed by atomic tasks with self-test before the next task.\n11. Always write the structured Gate result JSON file; Gate reads it before allowing phase advancement.\n12. If the workflow seems blocked, inspect agent-loop-docs/process/audit-events.jsonl for gate_decision_factors and workflow_state_transition before asking the user for business decisions.\n13. Do not run git add/commit/push/checkout/merge/rebase/reset/tag/branch or any branch mutation. You may only edit the task-allowed files directly.\n14. If git mutation is blocked by the runner, treat it as a system execution error and stop; do not retry with alternative git commands.\n`;
}

function printGateSummary({ gateSummary, runtimeStatus, issues, decisionPath, issuesPath, completionStatusPath, archivePath, iterationDir }) {
  const human = issues.filter((issue) => issue.decision_type === 'HUMAN_DECISION_REQUIRED');
  const auto = issues.filter((issue) => issue.decision_type === 'AUTO_FIXABLE');
  const repeated = issues.filter((issue) => Number(issue.repeat_count || 1) > 1);
  console.log('\n[agent-loop] 本轮结果');
  console.log(`- 原始 Gate：${gateSummary.status}`);
  console.log(`- 流程状态：${runtimeStatus}`);
  console.log(`- 自动修复问题：${auto.length}`);
  console.log(`- 需要用户决策：${human.length}`);
  console.log(`- 重复问题：${repeated.length}`);
  console.log(`- Gate 决策：${decisionPath}`);
  console.log(`- Issue 记录：${issuesPath}`);
  console.log(`- 看板：agent-loop-docs/process/agent-loop-dashboard.md`);
  console.log(`- 完成状态：${completionStatusPath}`);
  console.log('- 强审计日志：agent-loop-docs/process/audit-events.jsonl');
  if (archivePath) console.log(`- 归档：${archivePath}`);
  console.log(`- 运行产物：${path.relative(repoRoot, iterationDir)}`);
  if (human.length) {
    console.log('- 需要你决策的问题：');
    for (const issue of human.slice(0, 5)) console.log(`  - ${issue.issue_id}: ${issue.problem}`);
  }
  if (hasVerifierInconsistency(gateSummary, issues)) {
    console.log('- 诊断：Verifier inconsistent。Gate 未通过但没有明确 OPEN issue，先查看 npm run agent -- logs。');
  }
}

async function readPreviousIssues({ repoRoot, state }) {
  if (!state.recentIssuesPath) return [];
  try {
    const content = await readFile(path.join(repoRoot, state.recentIssuesPath), 'utf8');
    return parseIssuesMarkdown(content);
  } catch {
    return [];
  }
}

function applyIntegrationBranchGateResult({ gateSummary, integrationBranch, state }) {
  const conflicts = (integrationBranch?.conflicts || []).map(formatIntegrationIssue);
  const skipped = (integrationBranch?.skipped || []).map(formatIntegrationIssue);
  if (!conflicts.length && !skipped.length) return gateSummary;

  const semanticIssues = [
    ...conflicts.map((message) => ({
      kind: 'integration_branch_conflict',
      severity: 'BLOCKER',
      ownerAgent: 'brain_agent',
      sourceFile: 'agent/integration',
      targetFiles: ['agent/integration'],
      message: `Integration branch merge failed: ${message}`,
      expectedFix: 'Stop automatic progression and reconcile the implementation branches or manually resolve the integration branch conflict before rerunning the Gate.',
      verification: 'Rerun agent loop and confirm integrationBranch.conflicts is empty before workflow-state advances.',
      decisionType: 'HUMAN_DECISION_REQUIRED',
    })),
    ...skipped.map((message) => ({
      kind: 'integration_branch_skipped',
      severity: 'MAJOR',
      ownerAgent: 'brain_agent',
      sourceFile: 'agent/integration',
      targetFiles: ['agent/integration'],
      message: `Integration branch skipped a task: ${message}`,
      expectedFix: 'Inspect the skipped implementation task and ensure its code changes can be committed and merged into the integration branch.',
      verification: 'Rerun agent loop and confirm integrationBranch.skipped is empty or explicitly accepted by Brain Agent.',
      decisionType: 'AUTO_FIXABLE',
    })),
  ];

  const integrationRow = {
    task: 'integration-branch',
    agent: 'brain_agent',
    phase: state.phase,
    status: 'done',
    exitCode: 0,
    passed: false,
    expectedOutputs: [],
    missingOutputs: [],
    selfCheckMissing: [],
    failedOutputs: [],
    blockedOutputs: [],
    nextStageDenied: [],
    phaseRequirementsMissing: [],
    semanticIssues,
    gateResultIssues: [],
    disallowedChanges: [],
    codeIntegrationConflicts: [],
    unsupportedCodeChanges: [],
  };

  return {
    ...gateSummary,
    status: conflicts.length ? 'BLOCKED' : 'CHANGES_REQUESTED',
    rows: [...(gateSummary.rows || []), integrationRow],
  };
}

function hasVerifierInconsistency(gateSummary, issues = []) {
  if (!gateSummary?.rows?.length) return false;
  if (issues.length > 0) return false;
  return gateSummary.rows.some((row) => row.decisionFactors?.verifier_inconsistent || (row.gateResultCheck?.conclusion === 'PASS' && row.gateResultIssues?.length === 0 && row.passed === false));
}

function formatIntegrationIssue(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item);
  const parts = [];
  if (item.task) parts.push(`task=${item.task}`);
  if (item.branch) parts.push(`branch=${item.branch}`);
  if (item.reason) parts.push(`reason=${item.reason}`);
  if (item.message) parts.push(`message=${compactWhitespace(item.message)}`);
  return parts.join(' | ') || JSON.stringify(item);
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readOption(name) {
  const prefix = `${name}=`;
  const item = rawArgs.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function readNumberOption(name, fallback) {
  const value = readOption(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readTaskTimeoutMs() {
  const explicitMs = readNumberOption('--task-timeout-ms', null);
  if (explicitMs) return explicitMs;

  const explicitMinutes = readNumberOption('--task-timeout-minutes', null);
  if (explicitMinutes) return explicitMinutes * 60 * 1000;

  const envMinutes = Number(process.env.AGENT_LOOP_TASK_TIMEOUT_MINUTES || 60);
  return Number.isFinite(envMinutes) && envMinutes > 0 ? envMinutes * 60 * 1000 : 60 * 60 * 1000;
}

function normalizeMode(value) {
  const normalized = String(value || 'single').trim().toLowerCase().replace(/[ -]/g, '_');
  if (['single', 'cautious', 'auto'].includes(normalized)) return normalized;
  return 'single';
}

function assertLoopModeAllowed(mode) {
  if (mode !== 'auto') return;
  throw new Error([
    'AUTO mode unavailable.',
    'Auto requires task_context_package, worktree_manifest, session_registry, task_lock, and at least two stable Single runs.',
    'Use --mode=single until the capability gate is explicitly enabled.',
  ].join(' '));
}

function normalizeWorkflowStatus(value) {
  const normalized = String(value || 'READY').trim().toUpperCase().replace(/[ -]/g, '_');
  return ['READY', 'RUNNING', 'NEEDS_FIX', 'NEEDS_USER', 'BLOCKED_BY_SYSTEM', 'DONE'].includes(normalized)
    ? normalized
    : 'READY';
}

function resolveMaxLoops({ mode, explicitMaxLoops }) {
  if (explicitMaxLoops) return explicitMaxLoops;
  if (mode === 'single' || mode === 'cautious') return 1;
  const envMaxLoops = Number(process.env.AGENT_LOOP_MAX_LOOPS || 10);
  return Number.isFinite(envMaxLoops) && envMaxLoops > 0 ? envMaxLoops : 10;
}

function formatDurationMs(value) {
  const minutes = Math.round(value / 60000);
  if (minutes >= 1) return `${minutes} 分钟`;
  return `${Math.round(value / 1000)} 秒`;
}

function normalizeRunner(value) {
  return String(value || 'warp').trim().toLowerCase() === 'tmux' ? 'tmux' : 'warp';
}

function normalizeEngine(value) {
  return String(value || 'opencode').trim().toLowerCase() === 'codex' ? 'codex' : 'opencode';
}

function normalizeGateStatus(value) {
  return String(value || 'DRAFT').trim().toUpperCase().replace(/[ -]/g, '_');
}

function resolveModel(selectedEngine) {
  if (selectedEngine === 'opencode') return process.env.AGENT_LOOP_OPENCODE_MODEL || process.env.AGENT_LOOP_MODEL || 'deepseek/deepseek-v4-pro';
  return process.env.AGENT_LOOP_CODEX_MODEL || process.env.AGENT_LOOP_MODEL || 'gpt-5.5';
}

function gateNameForState(state) {
  if (state.gate && state.gate !== 'NONE') return state.gate;
  switch (state.phase) {
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
    default: return 'AUTO_GATE';
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
