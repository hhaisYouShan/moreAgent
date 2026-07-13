import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { AUDIT_EVENTS_PATH, readAuditEvents } from './audit-log.mjs';
import { isSystemFailureReason, readWorkflowState } from './state.mjs';
import { buildWorkflowRecommendation } from './recommendation.mjs';
import { formatBeijingTimestamp } from './time.mjs';

const CURRENT_RUN_FILE = '.agent-runs/current-run.json';
const CURRENT_TASKS_FILE = '.agent-runs/current-tasks.json';
const CURRENT_EVENTS_FILE = '.agent-runs/current-events.jsonl';
const ACTIVE_STATUSES = new Set(['PLANNED', 'RUNNING', 'GATE_CHECKING', 'WAITING_STATUS_JSON', 'LAUNCHING_AGENT', 'SYNCING_OUTPUTS', 'UPDATING_STATE']);

export async function clearCurrentRunState({ repoRoot, prdPath = null, featureKey = null, message = '新流程已初始化，暂无正在运行的 Agent 任务。' } = {}) {
  const now = formatBeijingTimestamp();
  await writeJson(repoRoot, CURRENT_RUN_FILE, {
    runId: null,
    featureKey,
    prdPath,
    phase: 'IDLE',
    gate: 'NONE',
    gateStatus: 'DRAFT',
    status: 'IDLE',
    step: 'IDLE',
    mode: null,
    maxLoops: null,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    runDir: null,
    parentPid: null,
    message,
  });
  await writeJson(repoRoot, CURRENT_TASKS_FILE, { runId: null, updatedAt: now, tasks: [] });
  await writeText(repoRoot, CURRENT_EVENTS_FILE, `${JSON.stringify({ time: now, type: 'run_idle', status: 'IDLE', step: 'IDLE', message })}\n`);
}

export async function writeRunStarted({ repoRoot, runId, runDir, iteration, state, tasks, mode = null, maxLoops = null }) {
  const now = formatBeijingTimestamp();
  const workflowRound = Number(state.round || 0) + 1;
  const run = {
    runId,
    featureKey: state.featureKey,
    phase: state.phase,
    gate: state.gate,
    gateStatus: state.gateStatus,
    workflowRound,
    round: workflowRound,
    runIteration: iteration,
    iteration,
    status: 'RUNNING',
    step: 'PLANNING',
    mode,
    maxLoops,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    runDir: relative(repoRoot, runDir),
    prdPath: state.prdPath,
    parentPid: process.pid,
    message: '子 Agent 正在运行。Task 完成不等于 Gate 通过；整体结果以 Gate/Verifier 为准。',
  };

  const taskItems = tasks.map((task) => ({
    taskId: task.id,
    agent: task.agent,
    displayName: task.displayName || task.windowName || task.title || task.id,
    responsibility: task.responsibility || task.title || '',
    phase: task.phase,
    round: task.round,
    status: 'PLANNED',
    step: 'PLANNED',
    startedAt: null,
    completedAt: null,
    exitCode: null,
    log: null,
    statusFile: null,
    script: null,
    outputs: task.outputFiles || [],
    gateResult: task.gateResultFile,
    failureReason: null,
  }));

  await writeJson(repoRoot, CURRENT_RUN_FILE, run);
  await writeJson(repoRoot, CURRENT_TASKS_FILE, { runId, updatedAt: now, tasks: taskItems });
  await writeText(repoRoot, CURRENT_EVENTS_FILE, '');
  await appendRunEvent({ repoRoot, type: 'run_started', status: 'RUNNING', step: 'PLANNING', message: `开始执行 Agent Loop：run_iteration=${iteration}，workflow_round=${workflowRound}。`, data: { runId, mode, maxLoops, phase: state.phase, taskCount: tasks.length, workflowRound, runIteration: iteration } });
}

export async function appendRunEvent({ repoRoot, type, message, status = null, step = null, task = null, data = {} }) {
  const event = {
    time: formatBeijingTimestamp(),
    type,
    status,
    step,
    task: task ? { id: task.id || task.taskId || null, agent: task.agent || null, displayName: task.displayName || task.windowName || null } : null,
    message,
    data,
  };
  const absolutePath = path.join(repoRoot, CURRENT_EVENTS_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function writeRunStep({ repoRoot, step, message, status = 'RUNNING', data = {} }) {
  await touchRun(repoRoot, { status, step, message });
  await appendRunEvent({ repoRoot, type: 'run_step', status, step, message, data });
}

export async function markTaskLaunched({ repoRoot, task, script }) {
  await updateTasks(repoRoot, (state) => {
    const item = state.tasks.find((taskItem) => taskItem.taskId === task.id);
    if (!item) return state;
    item.status = 'RUNNING';
    item.step = 'WAITING_STATUS_JSON';
    item.startedAt = item.startedAt || formatBeijingTimestamp();
    item.log = relative(repoRoot, script.logPath);
    item.statusFile = relative(repoRoot, script.statusPath);
    item.script = relative(repoRoot, script.scriptPath);
    item.outputs = task.outputFiles || item.outputs || [];
    item.gateResult = task.gateResultFile;
    item.displayName = task.displayName || item.displayName;
    item.responsibility = task.responsibility || item.responsibility;
    item.failureReason = null;
    return state;
  });
  await touchRun(repoRoot, { status: 'RUNNING', step: 'WAITING_STATUS_JSON', message: '子 Agent 已启动，正在等待 status.json。使用 /jobs 可查看最新日志尾部。' });
  await appendRunEvent({ repoRoot, type: 'task_launched', status: 'RUNNING', step: 'WAITING_STATUS_JSON', task, message: `${task.displayName} 已启动，正在等待 status.json。`, data: { log: relative(repoRoot, script.logPath), statusFile: relative(repoRoot, script.statusPath), script: relative(repoRoot, script.scriptPath) } });
}

export async function markTaskCompleted({ repoRoot, status }) {
  const normalizedStatus = taskStatusLabel(status.status);
  await updateTasks(repoRoot, (state) => {
    const item = state.tasks.find((taskItem) => taskItem.taskId === status.task);
    if (!item) return state;
    item.status = normalizedStatus;
    item.step = 'FINISHED';
    item.completedAt = formatBeijingTimestamp();
    item.exitCode = status.exitCode ?? null;
    item.failureReason = status.reason || status.statusReason || null;
    return state;
  });
  await appendRunEvent({ repoRoot, type: 'task_completed', status: normalizedStatus, step: 'FINISHED', task: { id: status.task, agent: status.agent, displayName: status.displayName }, message: `${status.displayName || status.task} 已结束，状态：${statusLabel(normalizedStatus)}。注意：Task DONE 只表示子进程完成，整体是否通过仍取决于 Gate/Verifier。`, data: { exitCode: status.exitCode ?? null, reason: status.reason || status.statusReason || null } });
}

export async function markPendingTasksLost({ repoRoot, status = 'LOST', reason = '父进程结束前没有收到子 Agent status.json。' } = {}) {
  const lostTasks = [];
  await updateTasks(repoRoot, (state) => {
    for (const item of state.tasks || []) {
      if (!ACTIVE_STATUSES.has(String(item.status || '').toUpperCase())) continue;
      item.status = status;
      item.step = status;
      item.completedAt = formatBeijingTimestamp();
      item.failureReason = reason;
      lostTasks.push(item);
    }
    return state;
  });
  for (const task of lostTasks) {
    await appendRunEvent({ repoRoot, type: 'task_lost', status, step: status, task, message: `${task.displayName} 未正常写出 status.json：${reason}` });
  }
}

export async function writeGateChecking({ repoRoot }) {
  await touchRun(repoRoot, { status: 'GATE_CHECKING', step: 'GATE_CHECKING', message: '子 Agent 已结束，正在检查 Gate 和同步产物。' });
  await appendRunEvent({ repoRoot, type: 'gate_checking', status: 'GATE_CHECKING', step: 'GATE_CHECKING', message: '子 Agent 已结束，正在检查 Gate 和同步产物。' });
}

export async function writeRunFinished({ repoRoot, status, gateSummary, issues = [], decisionPath, issuesPath, completionStatusPath }) {
  const workflowState = await readWorkflowState(repoRoot).catch(() => null);
  const recommendation = workflowState
    ? buildWorkflowRecommendation({
      workflowStatus: workflowState.status || workflowState.workflowStatus,
      controllerStep: workflowState.step,
      humanIssueIds: issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').map((item) => item.issue_id).filter(Boolean),
      ownerAgents: workflowState.ownerAgents || workflowState.ownerAgent,
      failureReason: workflowState.failureReason,
    })
    : null;
  const workflowSnapshot = workflowState ? {
    phase: workflowState.phase,
    gate: workflowState.gate,
    gateStatus: workflowState.gateStatus,
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    failureReason: workflowState.failureReason || null,
    activeAgent: workflowState.activeAgent || workflowState.nextAgent || null,
    ownerAgent: workflowState.ownerAgent || workflowState.ownerAgents || null,
    recommendedAction: recommendation?.action || null,
    recommendedCommand: recommendation?.command || null,
    recommendationMessage: recommendation?.message || null,
  } : null;
  const message = recommendation?.message || finishMessage({ status, issues });

  await touchRun(repoRoot, {
    executionStatus: 'FINISHED',
    status: 'FINISHED',
    step: 'FINISHED',
    finishedAt: formatBeijingTimestamp(),
    phase: workflowState?.phase,
    gate: workflowState?.gate,
    gateStatus: workflowState?.gateStatus,
    workflowStatus: workflowState?.status || workflowState?.workflowStatus,
    controllerStep: workflowState?.step,
    failureReason: workflowState?.failureReason || null,
    workflowSnapshot,
    gateSummaryStatus: gateSummary?.status || status,
    issueCount: issues.length,
    systemIssueCount: countSystemIssues(issues),
    autoFixableCount: countAutoFixableIssues(issues),
    humanDecisionCount: issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').length,
    recommendedAction: recommendation?.action || null,
    recommendedCommand: recommendation?.command || null,
    decisionPath,
    issuesPath,
    completionStatusPath,
    message,
  });
  await appendRunEvent({
    repoRoot,
    type: 'run_finished',
    status: workflowSnapshot?.workflowStatus || status,
    step: workflowSnapshot?.controllerStep || 'FINISHED',
    message,
    data: { gateSummaryStatus: gateSummary?.status || status, workflowSnapshot, issueCount: issues.length, decisionPath, issuesPath, completionStatusPath },
  });
}

export async function syncCurrentRunWorkflowSnapshot({ repoRoot, workflowState, issues = [], decisionPath = null, issuesPath = null, verificationAttempt = null }) {
  const recommendation = workflowState
    ? buildWorkflowRecommendation({
      workflowStatus: workflowState.status || workflowState.workflowStatus,
      controllerStep: workflowState.step,
      humanIssueIds: issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').map((item) => item.issue_id).filter(Boolean),
      ownerAgents: workflowState.ownerAgents || workflowState.ownerAgent,
      failureReason: workflowState.failureReason,
    })
    : null;

  const workflowSnapshot = workflowState ? {
    phase: workflowState.phase,
    gate: workflowState.gate,
    gateStatus: workflowState.gateStatus,
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    failureReason: workflowState.failureReason || null,
    activeAgent: workflowState.activeAgent || workflowState.nextAgent || null,
    ownerAgent: workflowState.ownerAgent || workflowState.ownerAgents || null,
    recommendedAction: recommendation?.action || null,
    recommendedCommand: recommendation?.command || null,
    recommendationMessage: recommendation?.message || null,
    verification_attempt: verificationAttempt ?? null,
  } : null;

  const patch = {
    workflowSnapshot,
    phase: workflowState?.phase,
    gate: workflowState?.gate,
    gateStatus: workflowState?.gateStatus,
    workflowStatus: workflowState?.status || workflowState?.workflowStatus,
    controllerStep: workflowState?.step,
    failureReason: workflowState?.failureReason || null,
    systemIssueCount: countSystemIssues(issues),
    autoFixableCount: countAutoFixableIssues(issues),
    humanDecisionCount: issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').length,
    recommendedAction: recommendation?.action || null,
    recommendedCommand: recommendation?.command || null,
  };
  if (decisionPath !== null) patch.decisionPath = decisionPath;
  if (issuesPath !== null) patch.issuesPath = issuesPath;
  await touchRun(repoRoot, patch);
}

export async function writeRunFailed({ repoRoot, status = 'FAILED', error, reason }) {
  const message = reason || error?.message || String(error || 'Agent Loop 异常退出。');
  const taskStatus = status === 'ABORTED' ? 'ABORTED' : status === 'TIMEOUT' ? 'TIMEOUT' : 'LOST';
  await markPendingTasksLost({ repoRoot, status: taskStatus, reason: message });
  await touchRun(repoRoot, { status, step: status, finishedAt: formatBeijingTimestamp(), error: message, message: `Agent Loop 已异常结束：${message}` });
  await appendRunEvent({ repoRoot, type: 'run_failed', status, step: status, message: `Agent Loop 已异常结束：${message}` });
}

export async function renderJobs({ repoRoot }) {
  const { run, tasks } = await readCurrentRunState(repoRoot);
  const workflowState = await readWorkflowState(repoRoot).catch(() => null);
  if (!run) return '当前没有正在记录的 Agent 任务。';

  const workflowDiagnosis = workflowState ? summarizeWorkflowDiagnosis(workflowState) : null;
  const workflowRecommendation = workflowState ? buildWorkflowRecommendation({
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    humanIssueIds: workflowState.humanIssueIds || workflowState.human_issue_ids || [],
    ownerAgents: workflowState.ownerAgents || workflowState.ownerAgent,
    failureReason: workflowState.failureReason,
  }) : null;
  const displayRunStatus = run.executionStatus || run.status;
  const displayMessage = workflowRecommendation?.message || run.message;
  const parentAlive = isParentAlive(run.parentPid);
  const lastEvent = (await readEvents(repoRoot, 1))[0];
  const lines = [
    '当前 Agent 运行状态',
    '',
    `运行 ID：${run.runId || 'N/A'}`,
    `业务阶段：${workflowState?.phase || run.workflowSnapshot?.phase || run.phase || 'N/A'}`,
    `业务轮次 workflow_round：${run.workflowRound || run.round || 'N/A'}`,
    `本次命令内部迭代 run_iteration：${run.runIteration || run.iteration || 'N/A'}`,
    `运行状态：${statusLabel(displayRunStatus)}`,
    `Workflow 状态：${statusLabel(workflowState?.status || run.workflowSnapshot?.workflowStatus || 'N/A')}`,
    `Controller 步骤：${statusLabel(workflowState?.step || run.workflowSnapshot?.controllerStep || 'N/A')}`,
    `Workflow Gate：${workflowState?.gate || run.workflowSnapshot?.gate || 'N/A'} / ${workflowState?.gateStatus || run.workflowSnapshot?.gateStatus || 'N/A'}`,
    `模式：${run.mode || 'N/A'}`,
    `最大循环数：${run.maxLoops || 'N/A'}`,
    `开始时间：${run.startedAt || 'N/A'}`,
    `更新时间：${run.updatedAt || 'N/A'}`,
    `结束时间：${run.finishedAt || 'N/A'}`,
    `运行目录：${run.runDir || 'N/A'}`,
    '',
    '状态解释：子 Agent DONE 只表示任务进程完成；整体 APPROVED / BLOCKED / CHANGES_REQUESTED 由 Gate/Verifier 决定。',
  ];

  if (workflowDiagnosis) {
    lines.push('', 'Workflow 诊断：');
    lines.push(`- 当前判断：${workflowDiagnosis.label}`);
    lines.push(`- 是否需要用户业务决策：${workflowDiagnosis.needsUser ? '是' : '否'}`);
    lines.push(`- 建议下一步：${workflowRecommendation?.message || workflowDiagnosis.nextStep}`);
    lines.push(`- 推荐命令：${workflowRecommendation?.command || '无；先处理当前阻塞或等待运行完成。'}`);
  }

  if (run.parentPid) lines.push(`父进程 PID：${run.parentPid}（${parentAlive ? '存活' : '不可见或已退出'}）`);
  if (isRunningStatus(run.status) && run.parentPid && !parentAlive) lines.push('警告：运行态显示仍在运行，但父进程已不可见，建议查看日志或重新执行。');
  if (lastEvent) lines.push(`最近事件：${lastEvent.time} ${lastEvent.message}`);
  if (displayMessage) lines.push(`说明：${displayMessage}`);
  if (run.error) lines.push(`错误：${run.error}`);
  if (run.decisionPath) lines.push(`Gate 决策：${run.decisionPath}`);
  if (run.issuesPath) lines.push(`Issue 记录：${run.issuesPath}`);
  lines.push(`强审计日志：${AUDIT_EVENTS_PATH}`);

  lines.push('', '子 Agent：');
  if (!tasks.length) lines.push('- 暂无。');
  for (const task of tasks) {
    lines.push(`- ${task.displayName}`);
    lines.push(`  状态：${statusLabel(task.status)}${task.exitCode !== null && task.exitCode !== undefined ? `，退出码：${task.exitCode}` : ''}`);
    if (task.step) lines.push(`  步骤：${statusLabel(task.step)}`);
    if (task.failureReason) lines.push(`  失败原因：${task.failureReason}`);
    if (task.responsibility) lines.push(`  职责：${task.responsibility}`);
    if (task.log) {
      lines.push(`  日志：${task.log}`);
      const activity = await logActivity(repoRoot, task.log);
      if (activity.updatedAt) lines.push(`  最后日志活动：${activity.updatedAt}`);
      if (activity.tail.length) {
        lines.push('  最近日志：');
        for (const item of activity.tail) lines.push(`    ${item}`);
      }
    }
    if (task.statusFile) lines.push(`  状态文件：${task.statusFile}`);
    if (task.script) lines.push(`  重跑脚本：${task.script}`);
    if (task.outputs?.length) lines.push(`  产物：${task.outputs.join(', ')}`);
  }

  return lines.join('\n');
}

export async function renderLogs({ repoRoot, raw = false, lines = 80 } = {}) {
  if (!raw) return renderEventSummary({ repoRoot, lines });

  const { tasks } = await readCurrentRunState(repoRoot);
  const withLogs = tasks.filter((task) => task.log);
  if (!withLogs.length) return '当前没有可读取的子 Agent 原始日志。';

  const output = [];
  for (const task of withLogs) {
    const absoluteLogPath = path.join(repoRoot, task.log);
    if (!existsSync(absoluteLogPath)) continue;
    const content = await readFile(absoluteLogPath, 'utf8');
    const tail = content.split('\n').slice(-lines).join('\n').trim();
    output.push(`## ${task.displayName}`);
    output.push(`日志：${task.log}`);
    output.push('');
    output.push(tail || '原始日志暂无内容。');
    output.push('');
  }

  return output.join('\n').trim() || '当前日志文件存在，但没有可显示内容。';
}

export async function readCurrentRunState(repoRoot) {
  const run = await readJson(repoRoot, CURRENT_RUN_FILE, null);
  const taskState = await readJson(repoRoot, CURRENT_TASKS_FILE, { tasks: [] });
  return { run, tasks: taskState.tasks || [] };
}

async function renderEventSummary({ repoRoot, lines = 80 }) {
  const [events, auditEvents] = await Promise.all([
    readEvents(repoRoot, lines),
    readAuditEvents({ repoRoot, limit: lines }),
  ]);
  const workflowState = await readWorkflowState(repoRoot).catch(() => null);
  const workflowDiagnosis = workflowState ? summarizeWorkflowDiagnosis(workflowState) : null;
  if (!events.length && !auditEvents.length) return '当前没有结构化运行事件。使用 /logs raw 查看子 Agent 原始日志。';

  const output = ['结构化运行事件', ''];
  if (events.length) {
    for (const event of events) {
      const task = event.task?.displayName ? `｜${event.task.displayName}` : '';
      const displayEventStatus = workflowDiagnosis?.label === 'BLOCKED_BY_SYSTEM' && String(event.status || '').toUpperCase() === 'BLOCKED'
        ? 'BLOCKED_BY_SYSTEM'
        : event.status;
      const status = displayEventStatus ? `｜${statusLabel(displayEventStatus)}` : '';
      const step = event.step ? `｜${statusLabel(event.step)}` : '';
      const message = workflowDiagnosis?.label === 'BLOCKED_BY_SYSTEM' && String(event.status || '').toUpperCase() === 'BLOCKED'
        ? '当前轮次结束于系统阻塞，不需要用户业务决策；应先修 Agent Loop / Gate / runner。'
        : event.message;
      output.push(`- ${event.time}${task}${status}${step}：${message}`);
    }
  } else {
    output.push('- 当前没有 run event。');
  }

  const diagnostics = auditEvents.filter(isDiagnosticAuditEvent).slice(-20);
  output.push('', '强审计诊断', '');
  if (!diagnostics.length) {
    output.push(`- 暂无强诊断事件。审计流路径：${AUDIT_EVENTS_PATH}`);
  } else {
    for (const event of diagnostics) output.push(renderAuditEventLine(event));
  }

  output.push('', `审计流：${AUDIT_EVENTS_PATH}`, '原始日志：/logs raw');
  return output.join('\n');
}

async function readEvents(repoRoot, limit = 80) {
  const absolutePath = path.join(repoRoot, CURRENT_EVENTS_FILE);
  try {
    const raw = await readFile(absolutePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .slice(-limit);
  } catch {
    return [];
  }
}

function isDiagnosticAuditEvent(event) {
  if (!event) return false;
  if (event.event === 'workflow_state_source_split') return true;
  if (event.event === 'workflow_state_reconciled_from_markdown') return true;
  if (event.event === 'workflow_state_transition') return true;
  if (event.event === 'gate_decision_factors') return event.failure_reason || event.verifier_inconsistent || event.row_passed === false;
  return false;
}

function renderAuditEventLine(event) {
  if (event.event === 'gate_decision_factors') {
    const systemError = isSystemFailureReason(event.failure_reason) || event.verifier_inconsistent || event.task_reason === 'git_mutation_blocked';
    return [
      `- ${event.timestamp}｜Gate 判定因子｜${event.task_id || 'N/A'}`,
      `  Gate 未通过原因：${event.failure_reason || 'none'}`,
      `  task_reason：${event.task_reason || 'N/A'}`,
      `  Self Check 原始结论：${event.self_check_conclusion_raw || 'N/A'}`,
      `  Self Check 解析结论：${event.self_check_conclusion_parsed ?? 'null'}`,
      `  是否允许进入下一阶段原文：${event.allows_next_stage_raw || 'N/A'}`,
      `  是否允许进入下一阶段解析：${event.allows_next_stage_parsed ?? 'null'}`,
      `  gate_result：${event.gate_result_conclusion || 'N/A'}；open issues：${event.gate_result_open_issues ?? 'N/A'}；row.passed=${event.row_passed}`,
      `  human_issue_count=${event.human_issue_count ?? 'N/A'}；auto_issue_count=${event.auto_issue_count ?? 'N/A'}；system_error=${systemError}`,
      event.output_files_present?.length ? `  产物存在：${event.output_files_present.join(', ')}` : null,
      systemError ? '  诊断：这是系统/执行层问题，不需要用户业务决策；优先修 Agent Loop / Gate / runner，并判断是否重跑同一 Agent。' : null,
      event.verifier_inconsistent ? '  诊断补充：Verifier inconsistent，非用户业务决策问题；优先修 Gate parser 或重新运行 Gate。' : null,
    ].filter(Boolean).join('\n');
  }

  if (event.event === 'workflow_state_transition') {
    const from = event.from || {};
    const to = event.to || {};
    const systemError = isSystemFailureReason(event.reason) || event.verifier_inconsistent || (event.human_issue_count === 0 && Number(event.auto_issue_count || 0) > 0 && String(to.status || '').toUpperCase() === 'BLOCKED_BY_SYSTEM');
    return [
      `- ${event.timestamp}｜状态迁移`,
      `  ${from.phase || 'N/A'} / ${from.gate_status || 'N/A'} / ${from.status || 'N/A'} -> ${to.phase || 'N/A'} / ${to.gate_status || 'N/A'} / ${to.status || 'N/A'}`,
      `  触发原因：${event.reason || event.transition_source || 'N/A'}；issue_count=${event.issue_count ?? 'N/A'}；human=${event.human_issue_count ?? 'N/A'}；auto=${event.auto_issue_count ?? 'N/A'}`,
      `  system_error=${systemError}`,
      systemError ? '  诊断：当前应视为系统阻塞，不应继续提示等待用户决策或 /decide。' : null,
      event.verifier_inconsistent ? '  诊断补充：Verifier inconsistent，状态迁移由系统判定异常触发。' : null,
    ].filter(Boolean).join('\n');
  }

  if (event.event === 'workflow_state_source_split') {
    return [
      `- ${event.timestamp}｜状态源分裂告警`,
      `  机器事实源：${formatAuditState(event.machine_source)}`,
      `  Markdown 展示层：${formatAuditState(event.markdown_source)}`,
      `  诊断：${event.diagnostic || event.message || 'workflow-state.md 与 workflow-state.json 不一致。'}`,
    ].join('\n');
  }

  if (event.event === 'workflow_state_reconciled_from_markdown') {
    return `- ${event.timestamp}｜状态源已自动修复：${event.message || '已同步 Markdown / JSON / Round Context。'}`;
  }

  return `- ${event.timestamp || event.time || 'N/A'}｜${event.event}：${event.message || JSON.stringify(event)}`;
}

function formatAuditState(state = {}) {
  if (!state) return 'N/A';
  return `${state.phase || 'N/A'} / ${state.gate_status || 'N/A'} / ${state.status || 'N/A'} / retry=${state.retry_count ?? state.failure_count ?? 'N/A'}`;
}

function summarizeWorkflowDiagnosis(state) {
  const status = String(state.status || '').toUpperCase();
  const failureReason = state.failureReason || state.failure_reason || 'unknown';
  if (status === 'BLOCKED_BY_SYSTEM') {
    return {
      label: 'BLOCKED_BY_SYSTEM',
      needsUser: false,
      nextStep: `先修 Agent Loop / Gate / runner。failure_reason=${failureReason}，推荐先看 npm run agent -- logs。`,
    };
  }
  if (status === 'NEEDS_USER') {
    return {
      label: 'NEEDS_USER',
      needsUser: true,
      nextStep: `需要 Brain Agent 汇总后向用户确认。failure_reason=${failureReason}。`,
    };
  }
  if (status === 'NEEDS_FIX') {
    return {
      label: 'NEEDS_FIX',
      needsUser: false,
      nextStep: `回流责任 Agent 修复即可。failure_reason=${failureReason}。`,
    };
  }
  return null;
}

async function logActivity(repoRoot, relativeLogPath) {
  const absolutePath = path.join(repoRoot, relativeLogPath);
  try {
    const [stats, content] = await Promise.all([stat(absolutePath), readFile(absolutePath, 'utf8')]);
    return { updatedAt: formatBeijingTimestamp(stats.mtime), tail: content.split('\n').map((line) => line.trim()).filter(Boolean).slice(-5) };
  } catch {
    return { updatedAt: null, tail: [] };
  }
}

async function updateTasks(repoRoot, updater) {
  const current = await readJson(repoRoot, CURRENT_TASKS_FILE, { tasks: [] });
  const updated = updater(current) || current;
  updated.updatedAt = formatBeijingTimestamp();
  await writeJson(repoRoot, CURRENT_TASKS_FILE, updated);
}

async function touchRun(repoRoot, patch) {
  const current = await readJson(repoRoot, CURRENT_RUN_FILE, {});
  await writeJson(repoRoot, CURRENT_RUN_FILE, { ...current, ...patch, updatedAt: formatBeijingTimestamp() });
}

async function readJson(repoRoot, file, fallback) {
  const absolutePath = path.join(repoRoot, file);
  try {
    return JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(repoRoot, file, value) {
  const absolutePath = path.join(repoRoot, file);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(repoRoot, file, value) {
  const absolutePath = path.join(repoRoot, file);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value, 'utf8');
}

function countSystemIssues(issues) {
  return issues.filter((item) => String(item.category || '').trim().toUpperCase() === 'SYSTEM').length;
}

function countAutoFixableIssues(issues) {
  return issues.filter((item) => item.decision_type === 'AUTO_FIXABLE' && String(item.category || '').trim().toUpperCase() !== 'SYSTEM').length;
}

function finishMessage({ status, issues }) {
  if (status === 'APPROVED') return '本轮已通过，workflow-state 已推进到下一阶段。';
  const human = issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED');
  if (human.length) return `本轮需要用户决策：${human.length} 个问题。请查看 Issue 记录或和主 Agent 讨论。`;
  if (!issues.length && status !== 'APPROVED') return '本轮未通过但没有 OPEN issue。疑似 Verifier inconsistent，请执行 npm run agent -- logs 查看强审计诊断。';
  return '本轮未通过，但问题可自动回流给责任 Agent，继续 /next 即可。';
}

function isParentAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function isRunningStatus(status) {
  return ACTIVE_STATUSES.has(String(status || '').toUpperCase());
}

function taskStatusLabel(value) {
  const normalized = String(value || 'UNKNOWN').trim().toUpperCase();
  switch (normalized) {
    case 'DONE': return 'DONE';
    case 'COMPLETED': return 'DONE';
    case 'SUCCESS': return 'DONE';
    case 'FAILED': return 'FAILED';
    case 'ERROR': return 'FAILED';
    case 'ABORTED': return 'ABORTED';
    case 'TIMEOUT': return 'TIMEOUT';
    case 'LOST': return 'LOST';
    default: return normalized || 'UNKNOWN';
  }
}

function statusLabel(value) {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  switch (normalized) {
    case 'RUNNING': return '运行中';
    case 'PLANNED': return '已计划';
    case 'WAITING_STATUS_JSON': return '等待子 Agent status.json';
    case 'LAUNCHING_AGENT': return '正在启动子 Agent';
    case 'GATE_CHECKING': return '正在 Gate 校验';
    case 'SYNCING_OUTPUTS': return '正在同步产物';
    case 'UPDATING_STATE': return '正在更新状态';
    case 'FINISHED': return '已结束';
    case 'DONE': return '已完成';
    case 'APPROVED': return '已通过';
    case 'CHANGES_REQUESTED': return '需要修复';
    case 'BLOCKED_BY_SYSTEM': return '系统阻塞';
    case 'BLOCKED': return '等待用户决策';
    case 'FAILED': return '失败';
    case 'TIMEOUT': return '超时';
    case 'ABORTED': return '已中断';
    case 'LOST': return '丢失';
    case 'IDLE': return '空闲';
    default: return normalized;
  }
}

function relative(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  renderJobs({ repoRoot: process.cwd() })
    .then((text) => console.log(text))
    .catch((error) => {
      console.error('[agent-run-status] failed');
      console.error(error.stack || error.message || error);
      process.exit(1);
    });
}
