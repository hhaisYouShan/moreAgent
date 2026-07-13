#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const prdPath = readOption('--prd') || 'docs/prd/bossresume-full-refactor-prd.md';
const failures = [];

const REQUIRED_FILES = [
  'AGENTS.md',
  'package.json',
  '.gitignore',
  'docs/README.md',
  'agent-loop-docs/README.md',
  'agent-loop-docs/process/workflow-state.md',
  'agent-loop-docs/process/workflow-state.json',
  'agent-loop-docs/process/round-context.json',
  'agent-loop-docs/process/completion-status.md',
  'agent-loop-docs/process/brain-discussion.md',
  'agent-loop-docs/process/brain-loop-protocol.md',
  'agent-loop-docs/process/gate-matrix.md',
  'agent-loop-docs/process/agent-registry.md',
  'agent-loop-docs/process/prd-review-standard.md',
  'agent-loop-docs/process/agent-doc-standard.md',
  'agent-loop-docs/process/codex-agent-prompts.md',
  'agent-loop-docs/process/confirmed-decisions.json',
  'agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md',
  'agent-loop-docs/reviews/README.md',
  'agent-loop-docs/tech/README.md',
  'agent-loop-docs/gate-results/README.md',
  'agent-loop-docs/decisions/README.md',
  'agent-loop-docs/issues/README.md',
  'agent-loop-docs/test-reports/README.md',
  'agent-loop-docs/acceptance/README.md',
  'agent-loop-docs/archive/README.md',
  'agent-loop-docs/archive/history/agent-brain-workflow.md',
  'agent-loop-docs/archive/history/codex-agent-workflow.md',
  'agent-loop-docs/archive/history/docs-cleanup-report.md',
  'agent-loop-docs/archive/history/multi-agent-workflow-verification-report.md',
  '.opencode/agent/brain_agent.md',
  '.opencode/agent/product_agent.md',
  '.opencode/agent/ui_agent.md',
  '.opencode/agent/frontend_agent.md',
  '.opencode/agent/backend_agent.md',
  '.opencode/agent/test_agent.md',
  '.opencode/agent/frontend_architect_agent.md',
  '.opencode/agent/backend_architect_agent.md',
  '.opencode/agent/review_agent.md',
  '.opencode/agent/repair_agent.md',
  'scripts/agent-loop/cli.mjs',
  'scripts/agent-loop/status.mjs',
  'scripts/agent-loop/time.mjs',
  'scripts/agent-loop/run-status.mjs',
  'scripts/agent-loop/conversation.mjs',
  'scripts/agent-loop/brain-chat.mjs',
  'scripts/agent-loop/orchestrator.mjs',
  'scripts/agent-loop/planner.mjs',
  'scripts/agent-loop/state.mjs',
  'scripts/agent-loop/state-cli.mjs',
  'scripts/agent-loop/worktree.mjs',
  'scripts/agent-loop/gate.mjs',
  'scripts/agent-loop/issue-router.mjs',
  'scripts/agent-loop/scope-guard.mjs',
  'scripts/agent-loop/code-sync.mjs',
  'scripts/agent-loop/self-check-policy.mjs',
  'scripts/agent-loop/checkpoint.mjs',
  'scripts/agent-loop/agents/brain-agent.md',
  'scripts/agent-loop/agents/product-agent.md',
  'scripts/agent-loop/agents/ui-agent.md',
  'scripts/agent-loop/agents/frontend-agent.md',
  'scripts/agent-loop/agents/backend-agent.md',
  'scripts/agent-loop/agents/test-agent.md',
  'scripts/agent-loop/agents/frontend-architect-agent.md',
  'scripts/agent-loop/agents/backend-architect-agent.md',
  'scripts/agent-loop/agents/review-agent.md',
  'scripts/agent-loop/agents/repair-agent.md',
];

const STATIC_CHECKS = [
  ['package.json', ['"agent"', 'agent:status', 'agent:brain', 'agent:loop:verify', 'agent:checkpoint']],
  ['.gitignore', ['agent-loop-docs/process/brain-conversation.jsonl', '.agent-runs/']],
  ['docs/README.md', ['agent-loop-docs/README.md', 'docs/prd/', '重复维护 Agent Loop 运行态文档']],
  ['agent-loop-docs/process/workflow-state.json', ['"status"', '"step"', '"phase"', '"gateStatus"']],
  ['agent-loop-docs/process/round-context.json', ['workflow_state_json', 'confirmed_decisions_file', 'input_search_patterns']],
  ['agent-loop-docs/process/workflow-state.md', ['PRD 路径', '项目类型', 'Issue Owner Agents', 'npm run agent -- next', 'ARCHITECTURE_IMPACT_REVIEW']],
  ['agent-loop-docs/process/brain-loop-protocol.md', ['Brain Agent 常驻对话框', 'brain-conversation.jsonl', '/status', '/preview', '/next', '/doctor', 'gate_result.json', 'confirmed-decisions.json']],
  ['agent-loop-docs/process/gate-matrix.md', ['PRD_GATE', 'ARCHITECTURE_GATE', 'UI_GATE', 'DESIGN_GATE', 'TEST_GATE', 'RECHECK_REQUIRED', 'issue_signature', 'user_confirmed', 'confirmed_by', 'DESIGN_REVIEW 六角色边界']],
  ['agent-loop-docs/process/agent-registry.md', ['总 Agent 边界', 'DESIGN_REVIEW 非重叠边界', 'user_confirmed', 'confirmed_by', '测试文件范围', 'repair_agent` 是兜底修复 Agent']],
  ['scripts/agent-loop/README.md', ['常驻对话框', 'brain-conversation.jsonl', 'confirmed-decisions.json', '/status', '/preview', '/next', '/doctor', '/history', '/exit', '--mode=auto', '--mode=single', 'current-events.jsonl']],
  ['scripts/agent-loop/cli.mjs', ['interactiveChat', 'conversationHelpText', '--once', '--tmux', '/status', '/jobs', '/watch', '/logs', '/preview', '/next', '/doctor', '/history', '/decide', 'runNodeBackground', 'parseSlashCommand', 'clearCurrentRunState', 'ensureModeArg', '--foreground']],
  ['scripts/agent-loop/time.mjs', ['BEIJING_TIME_ZONE', 'Asia/Shanghai', 'BEIJING_TIME_LABEL', '北京时间', 'formatBeijingTimestamp', 'formatBeijingRunId']],
  ['scripts/agent-loop/run-status.mjs', ['current-run.json', 'current-tasks.json', 'current-events.jsonl', 'workflow_round', 'run_iteration', 'clearCurrentRunState', 'writeRunStarted', 'writeRunStep', 'appendRunEvent', 'markTaskLaunched', 'markTaskCompleted', 'markPendingTasksLost', 'writeRunFailed', 'writeRunFinished', 'renderEventSummary', 'renderJobs', 'renderLogs', 'parentPid', 'TIMEOUT', 'ABORTED', 'LOST']],
  ['scripts/agent-loop/conversation.mjs', ['BEIJING_TIME_LABEL', 'formatBeijingTimestamp', 'brain-conversation.jsonl', 'confirmed-decisions.json', 'readConfirmedDecisions', 'renderConfirmedDecisions', 'appendConversationEntry', 'readConversation', 'renderRecentConversation', 'renderConversationHistory', 'conversationHelpText', '/jobs', '/watch', '/logs', '/decide', '/next --fresh-worktree']],
  ['scripts/agent-loop/brain-chat.mjs', ['BEIJING_TIME_LABEL', 'formatBeijingRunId', '最近主 Agent 对话', '已确认决策', '所有用户可见内容尽量使用中文', '所有用户可见时间', '--capture-output', '--history-limit', '--quiet', '--brief', '--formal-report', '不要输出 Self Check']],
  ['scripts/agent-loop/status.mjs', ['buildStatusCard', 'renderStatusCard', 'BossResume 多 Agent 当前状态', 'Workflow 压缩状态', 'failure_reason', '推荐命令', '预览命令']],
  ['scripts/agent-loop/state.mjs', ['workflow-state.json', 'round-context.json', 'READY', 'RUNNING', 'NEEDS_FIX', 'NEEDS_USER', 'DONE', 'Issue Owner Agents', 'RECHECK_REQUIRED', 'ARCHITECTURE_IMPACT_REVIEW', 'AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED', 'STRUCTURAL_RECHECK_SKIP_TYPES', 'issue_signature', 'retry_count', 'npm run agent -- start', 'npm run agent -- next']],
  ['scripts/agent-loop/planner.mjs', ['REQUIRED_CONTEXT_FILES', 'round-context.json', 'workflow-state.json', 'confirmed-decisions.json', 'inputSearchPatterns', 'LOOP_DOCS_ROOT', 'displayName', 'responsibility', '产品初审', 'PRD_REVIEW', 'ARCHITECTURE_IMPACT_REVIEW', 'UI_DESIGN', 'DEVELOPMENT_DESIGN', 'DESIGN_REVIEW', 'IMPLEMENTATION', 'TESTING', 'RECHECK_REQUIRED', 'TEST_ALLOWED_CHANGE_PATTERNS', 'allowedChangePatterns', 'client/**/*.test.*', 'product-design-review', 'atomic-task-review']],
  ['scripts/agent-loop/issue-router.mjs', ['stableIssueId', 'decision_applied', 'failure_reason', 'decision_type', 'AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED', 'requires_user_decision', 'issue_signature', 'repeat_count', 'annotateIssueRepeats', 'parseIssuesMarkdown', 'normalizeDecisionType']],
  ['scripts/agent-loop/gate.mjs', ['normalizeStructuredIssues', 'gate_result_issue_decision_type_missing', 'Markdown is intentionally limited to structural checks only', 'issues[]', 'decision_type', 'OPEN', 'CLOSED', 'checkUserAcceptanceGateResult', 'user_confirmed', 'confirmed_by', 'confirmed_at', 'CONFIRMED_DECISIONS_PATH', 'BEIJING_TIMESTAMP_PATTERN']],
  ['scripts/agent-loop/worktree.mjs', ['REQUIRED_PROTOCOL_FILES', 'validateWorktreeProtocol', 'isConcretePath', 'stale worktree detected', 'agent-loop-docs/process/prd-review-standard.md', 'agent-loop-docs/process/completion-status.md', 'Run `git pull`']],
  ['scripts/agent-loop/codex-runner.mjs', ['trap on_abort', 'trap on_exit', 'write_status aborted', 'script_exited_without_status', 'OpenCode native agent', 'agent_not_found']],
  ['scripts/agent-loop/checkpoint.mjs', ['sync-manifest.json', 'agent-loop checkpoint', 'changed_files']],
  ['scripts/agent-loop/scope-guard.mjs', ['matchesEditablePattern', 'test_agent', 'allowedChangePatterns', 'client/**/*.test.*', 'server/**/*.spec.*', 'isDisallowedAllowedTaskChange']],
  ['scripts/agent-loop/code-sync.mjs', ['tests/', 'e2e/', 'playwright.config.', 'vitest.config.', 'jest.config.']],
  ['scripts/agent-loop/agents/brain-agent.md', ['总大脑', '没有编写业务代码的权利', 'Recent Brain Conversation', '/preview', '/next', '用户验收硬边界', 'user_confirmed', 'confirmed_by']],
  ['scripts/agent-loop/agents/product-agent.md', ['PRODUCT_ACCEPTANCE', 'PRD 逐条对照表', '测试报告引用', '需求偏差清单', '是否允许进入 USER_ACCEPTANCE']],
  ['scripts/agent-loop/agents/frontend-architect-agent.md', ['ARCHITECTURE_IMPACT_REVIEW', '影响范围矩阵', '不可改边界', 'DESIGN_REVIEW 检查边界']],
  ['scripts/agent-loop/agents/backend-architect-agent.md', ['ARCHITECTURE_IMPACT_REVIEW', '现有 schema 对照', '接口影响矩阵', '迁移策略和不可改边界']],
  ['scripts/agent-loop/agents/test-agent.md', ['测试权限', 'allowCodeChanges', 'client/**/*.test.*', '禁止为了让测试通过而修改', 'DESIGN_REVIEW 检查边界']],
  ['scripts/agent-loop/agents/ui-agent.md', ['DESIGN_REVIEW 检查边界', '只检查视觉', '不审查产品范围']],
  ['scripts/agent-loop/agents/review-agent.md', ['跨文档一致性', '原子任务质量', '禁止重复 Product/UI/Test/Architect 的专项审查范围']],
  ['scripts/agent-loop/agents/repair-agent.md', ['兜底修复 Agent', '已确认 issue', '最小必要修复', '验证命令', 'Self Check']],
];

main().catch((error) => {
  console.error('[agent-loop:verify] 自检失败');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  console.log('[agent-loop:verify] 开始自检');

  await checkRequiredFiles();
  await checkStaticRequirements();
  await runNodeChecks();
  runCommand('状态卡', 'node', ['scripts/agent-loop/cli.mjs', 'status']);
  runCommand('运行任务状态', 'node', ['scripts/agent-loop/cli.mjs', 'jobs']);
  runCommand('主 Agent dry-run', 'node', ['scripts/agent-loop/brain-chat.mjs', '--dry-run', `--prd=${prdPath}`]);
  runCommand('主 Agent 轻量 dry-run', 'node', ['scripts/agent-loop/brain-chat.mjs', '--dry-run', '--quiet', '--brief', `--prd=${prdPath}`]);
  runCommand('Agent Loop dry-run', 'node', ['scripts/agent-loop/orchestrator.mjs', '--dry-run']);
  runCommand('Agent Loop single dry-run', 'node', ['scripts/agent-loop/orchestrator.mjs', '--dry-run', '--mode=single']);
  runCommand('git worktree 列表', 'git', ['worktree', 'list']);
  runCommand('opencode 版本', 'opencode', ['--version'], { optional: true });
  runCommand('codex 版本', 'codex', ['--version'], { optional: true });
  runCommand('tmux 版本', 'tmux', ['-V'], { optional: true });

  if (failures.length) {
    console.log('\n[agent-loop:verify] 未通过');
    for (const failure of failures) console.log(`- ${failure}`);
    process.exit(1);
  }

  console.log('\n[agent-loop:verify] 通过');
  console.log('- 必需文件存在');
  console.log('- 静态流程要求存在');
  console.log('- 脚本语法检查通过');
  console.log('- 状态卡命令通过');
  console.log('- 运行任务状态命令通过');
  console.log('- 主 Agent dry-run 通过');
  console.log('- Agent Loop dry-run 通过');
  console.log('- git worktree 检查通过');
}

async function checkRequiredFiles() {
  console.log('\n[agent-loop:verify] 检查必需文件');
  for (const file of REQUIRED_FILES) {
    try {
      await access(path.join(repoRoot, file));
      console.log(`OK ${file}`);
    } catch {
      failures.push(`缺少必需文件：${file}`);
    }
  }
}

async function checkStaticRequirements() {
  console.log('\n[agent-loop:verify] 检查静态规则');
  for (const [file, needles] of STATIC_CHECKS) {
    const content = await readText(file);
    if (content === null) continue;
    for (const needle of needles) {
      if (!content.includes(needle)) failures.push(`${file} 缺少必需标记：${needle}`);
    }
  }
}

async function readText(file) {
  try {
    return await readFile(path.join(repoRoot, file), 'utf8');
  } catch {
    failures.push(`无法读取文件：${file}`);
    return null;
  }
}

async function runNodeChecks() {
  const files = await listMjsFiles(path.join(repoRoot, 'scripts/agent-loop'));
  for (const file of files) runCommand(`node --check ${path.relative(repoRoot, file)}`, 'node', ['--check', file]);
}

async function listMjsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMjsFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(fullPath);
  }
  return files.sort();
}

function runCommand(label, command, args, options = {}) {
  console.log(`\n[agent-loop:verify] ${label}`);
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 && !options.optional) failures.push(`${label} 退出码：${result.status}`);
  if (result.status !== 0 && options.optional) console.log(`[agent-loop:verify] 可选检查不可用或已跳过：${label}`);
}

function readOption(name) {
  const prefix = `${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}
