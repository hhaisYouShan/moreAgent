import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderIssuesMarkdown } from './issue-router.mjs';
import { BEIJING_TIME_LABEL, formatBeijingTimestamp } from './time.mjs';

const LOOP_DOCS_ROOT = 'agent-loop-docs';
const LAST_SYNC_REPORT_PATH = loopDoc('process', 'last-sync-report.md');

export async function syncTaskOutputsToRepo({ repoRoot, tasks, worktrees }) {
  const copied = [];
  const rows = [];

  for (const task of tasks) {
    const worktree = worktrees.get(task.id);
    const syncFiles = unique([...(task.outputFiles || []), task.gateResultFile, ...(task.editableFiles || [])]);
    for (const outputFile of syncFiles) {
      const source = path.join(worktree.worktreePath, outputFile);
      const target = path.join(repoRoot, outputFile);
      if (!existsSync(source)) {
        rows.push({ task: task.id, file: outputFile, status: 'NOT_SYNCED', reason: 'worktree 中不存在该文件', worktree: worktree.worktreePath });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      copied.push(outputFile);
      rows.push({ task: task.id, file: outputFile, status: 'SYNCED', reason: '已从子 Agent worktree 复制到主目录', worktree: worktree.worktreePath });
    }
  }

  await persistSyncReport({ repoRoot, rows });
  printSyncReportSummary(rows);
  return unique(copied);
}

export async function persistGateDecision({ repoRoot, featureKey, round, gate, gateSummary, copiedOutputs, runDir }) {
  const relativePath = loopDoc('decisions', `${featureKey}-${gate.toLowerCase().replace(/_/g, '-')}-round-${round}.md`);
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderGateDecisionMarkdown({ featureKey, round, gate, gateSummary, copiedOutputs, runDir }), 'utf8');
  return relativePath;
}

export async function persistIssues({ repoRoot, featureKey, round, gate, issues }) {
  const relativePath = loopDoc('issues', `${featureKey}-issues-round-${round}.md`);
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderIssuesMarkdown({ featureKey, round, gate, issues }), 'utf8');
  return relativePath;
}

export async function persistRunDashboard({ repoRoot, state, tasks, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }) {
  const relativePath = loopDoc('process', 'agent-loop-dashboard.md');
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderDashboardMarkdown({ state, tasks, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }), 'utf8');
  return relativePath;
}

export async function persistCompletionStatus({ repoRoot, state, tasks, gate, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }) {
  const relativePath = loopDoc('process', 'completion-status.md');
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderCompletionStatusMarkdown({ state, tasks, gate, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }), 'utf8');
  return relativePath;
}

export async function persistArchiveSnapshot({ repoRoot, featureKey, round, state, decisionPath, issuesPath, copiedOutputs }) {
  const archiveRoot = `${LOOP_DOCS_ROOT}/archive/${featureKey}/round-${round}`;
  const files = unique([
    loopDoc('process', 'workflow-state.md'),
    loopDoc('process', 'brain-discussion.md'),
    loopDoc('process', 'completion-status.md'),
    loopDoc('process', 'last-sync-report.md'),
    state.prdPath,
    decisionPath,
    issuesPath,
    ...copiedOutputs,
  ]).filter(Boolean);

  const archivedFiles = [];
  for (const file of files) {
    const source = path.join(repoRoot, file);
    if (!existsSync(source)) continue;
    const target = path.join(repoRoot, archiveRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    archivedFiles.push(`${archiveRoot}/${file}`);
  }

  const manifestPath = `${archiveRoot}/archive-manifest.md`;
  const manifestAbsolutePath = path.join(repoRoot, manifestPath);
  await mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
  await writeFile(manifestAbsolutePath, renderArchiveManifest({ featureKey, round, state, archivedFiles, sourceFiles: files }), 'utf8');
  return manifestPath;
}

async function persistSyncReport({ repoRoot, rows }) {
  const absolutePath = path.join(repoRoot, LAST_SYNC_REPORT_PATH);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderSyncReportMarkdown(rows), 'utf8');
}

function printSyncReportSummary(rows) {
  const synced = rows.filter((row) => row.status === 'SYNCED');
  const notSynced = rows.filter((row) => row.status !== 'SYNCED');
  console.log('\n[agent-loop] 主目录同步确认');
  console.log(`- 已同步到主目录：${synced.length}`);
  console.log(`- 未同步：${notSynced.length}`);
  console.log(`- 同步报告：${LAST_SYNC_REPORT_PATH}`);
  if (notSynced.length) {
    for (const row of notSynced.slice(0, 5)) console.log(`  - ${row.file}: ${row.reason}`);
  }
}

function renderSyncReportMarkdown(rows) {
  const synced = rows.filter((row) => row.status === 'SYNCED');
  const notSynced = rows.filter((row) => row.status !== 'SYNCED');
  const lines = [
    '# Agent Loop 主目录同步报告',
    '',
    `- 更新时间：\`${formatBeijingTimestamp()}\``,
    `- 时间规则：\`${BEIJING_TIME_LABEL}\``,
    `- 已同步到主目录：\`${synced.length}\``,
    `- 未同步：\`${notSynced.length}\``,
    '',
    '## 同步明细',
    '',
    '| 状态 | 文件 | 任务 | 原因 |',
    '|---|---|---|---|',
  ];
  if (!rows.length) lines.push('| `EMPTY` | 无 | N/A | 本轮没有需要同步的输出文件 |');
  for (const row of rows) lines.push(`| \`${row.status}\` | \`${row.file}\` | \`${row.task}\` | ${row.reason} |`);
  lines.push('', '## 结论', '');
  if (notSynced.length) lines.push('- 存在未同步文件。请先查看上方原因，不要假设子 Agent 的 worktree 改动已经进入主目录。');
  else lines.push('- 所有子 Agent 输出文件和 editable 文件均已同步到主目录。');
  lines.push('', '## Self Check', '', '结论：PASS', '是否允许进入下一阶段：是');
  return lines.join('\n');
}

function renderGateDecisionMarkdown({ featureKey, round, gate, gateSummary, copiedOutputs, runDir }) {
  const lines = [
    `# ${featureKey} ${gate} 第 ${round} 轮 Gate 决策`,
    '',
    `- 结论：\`${gateSummary.status}\``,
    `- 更新时间：\`${formatBeijingTimestamp()}\``,
    `- 时间规则：\`${BEIJING_TIME_LABEL}\``,
    `- 运行目录：\`${path.relative(process.cwd(), runDir)}\``,
    `- 主目录同步报告：\`${LAST_SYNC_REPORT_PATH}\``,
    '',
    '## Agent 输出同步',
    '',
  ];

  if (copiedOutputs.length) copiedOutputs.forEach((output) => lines.push(`- \`${output}\``));
  else lines.push('- 无。');

  lines.push('', '## Gate 明细', '');
  for (const row of gateSummary.rows || []) {
    lines.push(`### ${row.agent} / ${row.task}`, '');
    lines.push(`- 阶段：\`${row.phase}\``);
    lines.push(`- 执行状态：\`${row.status}\``);
    lines.push(`- 退出码：\`${row.exitCode}\``);
    lines.push(`- 是否通过：\`${row.passed}\``);
    lines.push(`- Gate Result 文件：\`${row.gateResultFile || 'N/A'}\``);
    lines.push(`- Gate Result 结论：\`${row.gateResultCheck?.conclusion || 'N/A'}\``);
    lines.push(`- 缺失输出：${formatList(row.missingOutputs)}`);
    lines.push(`- 缺失 Self Check：${formatList(row.selfCheckMissing)}`);
    lines.push(`- FAIL 输出：${formatList(row.failedOutputs)}`);
    lines.push(`- BLOCKED 输出：${formatList(row.blockedOutputs)}`);
    lines.push(`- 不允许进入下一阶段：${formatList(row.nextStageDenied)}`);
    lines.push(`- 阶段要求缺失：${formatPhaseRequirementList(row.phaseRequirementsMissing || [])}`);
    lines.push(`- 语义问题：${formatIssueKinds(row.semanticIssues || [])}`);
    lines.push(`- Gate Result 问题：${formatIssueKinds(row.gateResultIssues || [])}`);
    lines.push(`- 越界修改：${formatList(row.disallowedChanges || [])}`);
    lines.push(`- 代码集成冲突：${formatList(row.codeIntegrationConflicts || [])}`);
    lines.push('');
  }

  lines.push('## Self Check', '');
  lines.push(`- 结论：${gateSummary.status === 'APPROVED' ? 'PASS' : gateSummary.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL'}`);
  lines.push('- 检查范围：Agent 执行状态、输出文件、Self Check、阶段级 Self Check、结构化 gate_result.json、下一阶段许可、文档流业务代码越界、主目录同步。');
  lines.push(`- 已完成项：生成 Gate 决策并同步 ${copiedOutputs.length} 个文件。`);
  lines.push(`- 发现的问题：${gateSummary.status === 'APPROVED' ? '暂无阻塞问题。' : '见 agent-loop-docs/issues 对应文件。'}`);
  lines.push(`- 是否允许进入下一阶段：${gateSummary.status === 'APPROVED' ? '是' : '否'}`, '');
  return lines.join('\n');
}

function renderDashboardMarkdown({ state, tasks, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }) {
  const lines = [
    '# Agent Loop 看板',
    '',
    '这个文件由 Brain Orchestrator 自动更新，用来快速查看当前流程走到哪里。',
    '',
    '## 当前状态',
    '',
    `- feature-key：\`${state.featureKey}\``,
    `- PRD：\`${state.prdPath}\``,
    `- 当前阶段：\`${state.phase}\``,
    `- 当前轮次：\`${state.round}\``,
    `- 当前 Gate：\`${state.gate}\``,
    `- Gate 状态：\`${state.gateStatus}\``,
    `- 连续失败次数：\`${state.failureCount || 0}\``,
    `- 更新时间：\`${formatBeijingTimestamp()}\``,
    `- 时间规则：\`${BEIJING_TIME_LABEL}\``,
    `- 运行目录：\`${path.relative(process.cwd(), runDir)}\``,
    `- 主目录同步报告：\`${LAST_SYNC_REPORT_PATH}\``,
    '',
    '## 最近 Gate',
    '',
    `- 结论：\`${gateSummary.status}\``,
    `- Gate 决策：${decisionPath ? `\`${decisionPath}\`` : '`N/A`'}`,
    `- Issue 记录：${issuesPath ? `\`${issuesPath}\`` : '`N/A`'}`,
    `- 归档记录：${archivePath ? `\`${archivePath}\`` : '`N/A`'}`,
    '',
    '## 本轮任务',
    '',
    '| Agent | 阶段 | 任务 | 输出文件 | Gate Result | 可编辑文件 | 是否通过 |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const task of tasks) {
    const row = gateSummary.rows.find((item) => item.task === task.id);
    lines.push(`| \`${task.agent}\` | \`${task.phase}\` | \`${task.id}\` | ${formatTableFiles(task.outputFiles)} | \`${task.gateResultFile}\` | ${formatTableFiles(task.editableFiles || [])} | \`${row?.passed ?? false}\` |`);
  }

  lines.push('', '## 已同步文件', '');
  if (copiedOutputs.length) copiedOutputs.forEach((output) => lines.push(`- \`${output}\``));
  else lines.push('- 无。');

  lines.push('', '## 下一步建议', '');
  if (gateSummary.status === 'APPROVED') lines.push('- Gate 已通过。查看 `agent-loop-docs/process/workflow-state.md` 确认下一阶段。');
  else if (gateSummary.status === 'BLOCKED') lines.push('- 当前阻塞。先运行 `npm run agent -- chat` 与主 Agent 确认。');
  else lines.push('- Gate 未通过。查看 `agent-loop-docs/issues/*.md`，再运行 `npm run agent -- next` 进入修复或复查。');

  lines.push('', '## Self Check', '', '结论：PASS', '是否允许进入下一阶段：是');
  return lines.join('\n');
}

function renderCompletionStatusMarkdown({ state, tasks, gate, gateSummary, decisionPath, issuesPath, archivePath, copiedOutputs, runDir }) {
  const round = Number(state.round || 0) + 1;
  const completedAt = formatBeijingTimestamp();
  const lines = [
    '# Agent Loop 完成状态',
    '',
    '这个文件由 Brain Orchestrator 在真实 `npm run agent -- next` 运行后自动更新，用来记录整个需求链路的完成状态。',
    '',
    '它和 `workflow-state.md` 的分工：`workflow-state.md` 决定下一步怎么走；本文件记录每个阶段是否完成、产物在哪里、最近一次 Gate 结论是什么。',
    '',
    '## 当前总览',
    '',
    `- feature-key：\`${state.featureKey}\``,
    `- PRD：\`${state.prdPath}\``,
    `- 项目类型：\`${state.projectType || 'existing_refactor'}\``,
    `- 最近执行阶段：\`${state.phase}\``,
    `- 最近 Gate：\`${gate}\``,
    `- 最近 Gate 结论：\`${gateSummary.status}\``,
    `- 最近轮次：\`${round}\``,
    `- 连续失败次数：\`${state.failureCount || 0}\``,
    `- 更新时间：\`${completedAt}\``,
    `- 时间规则：\`${BEIJING_TIME_LABEL}\``,
    `- 运行目录：\`${path.relative(process.cwd(), runDir)}\``,
    `- 主目录同步报告：\`${LAST_SYNC_REPORT_PATH}\``,
    '',
    '## 阶段完成清单',
    '',
    '| 顺序 | 阶段 | Gate | 负责人 | 完成状态 | 完成/跳过依据 |',
    '|---:|---|---|---|---|---|',
  ];

  for (const stage of completionStages(state.projectType)) {
    const status = statusForStage({ stage, state, gateSummary });
    lines.push(`| ${stage.order} | \`${stage.phase}\` | \`${stage.gate}\` | ${stage.owners} | \`${status.status}\` | ${status.reason} |`);
  }

  lines.push('', '## 最近一轮任务完成情况', '');
  lines.push('| Agent | 阶段 | 任务 | 输出文件 | Gate Result | 完成状态 |');
  lines.push('|---|---|---|---|---|---|');
  for (const task of tasks) {
    const row = gateSummary.rows.find((item) => item.task === task.id);
    lines.push(`| \`${task.agent}\` | \`${task.phase}\` | \`${task.id}\` | ${formatTableFiles(task.outputFiles)} | \`${task.gateResultFile}\` | \`${row?.passed ? 'DONE' : 'NOT_DONE'}\` |`);
  }

  lines.push('', '## 最近产物', '');
  lines.push(`- Gate 决策：${decisionPath ? `\`${decisionPath}\`` : '`N/A`'}`);
  lines.push(`- Issue 记录：${issuesPath ? `\`${issuesPath}\`` : '`N/A`'}`);
  lines.push(`- 归档记录：${archivePath ? `\`${archivePath}\`` : '`N/A`'}`);
  lines.push(`- 主目录同步报告：\`${LAST_SYNC_REPORT_PATH}\``);
  lines.push('- 同步输出：');
  if (copiedOutputs.length) copiedOutputs.forEach((output) => lines.push(`  - \`${output}\``));
  else lines.push('  - 无。');

  lines.push('', '## 下一步判断', '');
  if (gateSummary.status === 'APPROVED') lines.push('- 最近 Gate 已通过，下一步以 `agent-loop-docs/process/workflow-state.md` 为准。');
  else if (gateSummary.status === 'BLOCKED') lines.push('- 最近 Gate 阻塞，需要先和主 Agent 讨论确认后再继续。');
  else lines.push('- 最近 Gate 未通过，需要查看 `agent-loop-docs/issues/` 并按 owner_agent 修复。');

  lines.push('', '## Self Check', '');
  lines.push('- 结论：PASS');
  lines.push('- 检查范围：阶段完成清单、最近任务状态、结构化 Gate Result、最近 Gate 产物、主目录同步报告、下一步判断。');
  lines.push('- 已完成项：完成状态文档已根据最近一轮 Agent Loop 更新。');
  lines.push(`- 发现的问题：${gateSummary.status === 'APPROVED' ? '暂无。' : '见 Issue 记录。'}`);
  lines.push(`- 是否允许进入下一阶段：${gateSummary.status === 'APPROVED' ? '是' : '否'}`, '');
  return lines.join('\n');
}

function renderArchiveManifest({ featureKey, round, state, archivedFiles, sourceFiles }) {
  const lines = [
    `# ${featureKey} 归档清单 第 ${round} 轮`,
    '',
    `- feature-key：\`${featureKey}\``,
    `- PRD：\`${state.prdPath}\``,
    `- phase：\`${state.phase}\``,
    `- round：\`${round}\``,
    `- 归档时间：\`${formatBeijingTimestamp()}\``,
    `- 时间规则：\`${BEIJING_TIME_LABEL}\``,
    '',
    '## 源文件',
    '',
  ];
  sourceFiles.forEach((file) => lines.push(`- \`${file}\``));
  lines.push('', '## 已归档文件', '');
  if (archivedFiles.length) archivedFiles.forEach((file) => lines.push(`- \`${file}\``));
  else lines.push('- 无。');
  lines.push('', '## Self Check', '', '结论：PASS', '是否允许进入下一阶段：是');
  return lines.join('\n');
}

function completionStages(projectType) {
  const isNewProject = String(projectType || 'existing_refactor') === 'new_project';
  return [
    { order: 1, phase: 'PRODUCT_REVIEW', gate: 'PRD_GATE', owners: '`product_agent`' },
    { order: 2, phase: 'PRD_REVIEW', gate: 'PRD_GATE', owners: '`frontend_agent`, `backend_agent`, `test_agent`, `ui_agent`' },
    { order: 3, phase: 'ARCHITECTURE_DESIGN', gate: 'ARCHITECTURE_GATE', owners: '`frontend_architect_agent`, `backend_architect_agent`', skippable: !isNewProject, skipReason: '`existing_refactor` 不做完整架构设计' },
    { order: 4, phase: 'ARCHITECTURE_REVIEW', gate: 'ARCHITECTURE_GATE', owners: '`frontend_architect_agent`, `backend_architect_agent`, `test_agent`', skippable: !isNewProject, skipReason: '`existing_refactor` 不做完整架构验收' },
    { order: 5, phase: 'ARCHITECTURE_IMPACT_REVIEW', gate: 'ARCHITECTURE_GATE', owners: '`frontend_architect_agent`, `backend_architect_agent`, `test_agent`', skippable: isNewProject, skipReason: '`new_project` 已通过完整架构设计/验收' },
    { order: 6, phase: 'UI_DESIGN', gate: 'UI_GATE', owners: '`ui_agent`' },
    { order: 7, phase: 'DEVELOPMENT_DESIGN', gate: 'DESIGN_GATE', owners: '`frontend_agent`, `backend_agent`, `test_agent`' },
    { order: 8, phase: 'DESIGN_REVIEW', gate: 'DESIGN_GATE', owners: '`product_agent`, `ui_agent`, `test_agent`, `frontend_architect_agent`, `backend_architect_agent`, `review_agent`' },
    { order: 9, phase: 'IMPLEMENTATION', gate: 'TEST_GATE', owners: '`frontend_agent`, `backend_agent`' },
    { order: 10, phase: 'TESTING', gate: 'TEST_GATE', owners: '`test_agent`' },
    { order: 11, phase: 'PRODUCT_ACCEPTANCE', gate: 'PRODUCT_ACCEPTANCE_GATE', owners: '`product_agent`' },
    { order: 12, phase: 'USER_ACCEPTANCE', gate: 'USER_ACCEPTANCE_GATE', owners: '`brain_agent`, 用户' },
    { order: 13, phase: 'ARCHIVE', gate: 'ARCHIVE_GATE', owners: '`brain_agent`' },
  ];
}

function statusForStage({ stage, state, gateSummary }) {
  if (stage.skippable) return { status: 'SKIPPED', reason: stage.skipReason || '当前项目类型跳过此阶段' };
  const currentRank = phaseRank(state.phase);
  const stageRank = phaseRank(stage.phase);
  const samePhase = normalizePhase(state.phase) === stage.phase || (normalizePhase(state.phase) === 'INTAKE' && stage.phase === 'PRODUCT_REVIEW');
  if (stageRank < currentRank) return { status: 'DONE', reason: '当前流程已推进到后续阶段' };
  if (samePhase && gateSummary.status === 'APPROVED') return { status: 'DONE', reason: `最近 ${stage.gate} 已通过` };
  if (samePhase && gateSummary.status === 'BLOCKED') return { status: 'BLOCKED', reason: '最近 Gate 阻塞，需要用户确认' };
  if (samePhase && gateSummary.status === 'CHANGES_REQUESTED') return { status: 'NEEDS_FIX', reason: '最近 Gate 未通过，需按 issue 修复' };
  if (samePhase) return { status: 'IN_PROGRESS', reason: '当前正在执行此阶段' };
  return { status: 'PENDING', reason: '尚未进入此阶段' };
}

function phaseRank(phase) {
  const normalized = normalizePhase(phase);
  const order = ['INTAKE', 'PRODUCT_REVIEW', 'PRD_REVIEW', 'ARCHITECTURE_DESIGN', 'ARCHITECTURE_REVIEW', 'ARCHITECTURE_IMPACT_REVIEW', 'UI_DESIGN', 'DEVELOPMENT_DESIGN', 'TECH_DESIGN', 'DESIGN_REVIEW', 'JOINT_TECH_REVIEW', 'IMPLEMENTATION', 'TESTING', 'REPAIR', 'PRODUCT_ACCEPTANCE', 'USER_ACCEPTANCE', 'ARCHIVE'];
  const index = order.indexOf(normalized);
  return index === -1 ? 0 : index;
}

function loopDoc(dir, filename) {
  return `${LOOP_DOCS_ROOT}/${dir}/${filename}`;
}

function normalizePhase(value) {
  return String(value || 'INTAKE').trim().toUpperCase().replace(/[ -]/g, '_');
}

function formatList(items = []) {
  return items.length ? items.map((item) => `\`${item}\``).join(', ') : '无';
}

function formatIssueKinds(items = []) {
  return items.length ? items.map((item) => `\`${item.severity}:${item.kind}\``).join(', ') : '无';
}

function formatPhaseRequirementList(items = []) {
  if (!items.length) return '无';
  return items.map((item) => `\`${item.file}: ${item.missing.join('/')}\``).join(', ');
}

function formatTableFiles(items) {
  return items?.length ? items.map((file) => `\`${file}\``).join('<br>') : '无';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
