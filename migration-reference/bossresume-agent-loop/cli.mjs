#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { initializeWorkflowState, readWorkflowState, writeWorkflowState } from './state.mjs';
import { appendAuditEvent } from './audit-log.mjs';
import { buildStatusCard, renderStatusCard } from './status.mjs';
import { appendConversationEntry, buildUserAcceptanceTaskId, conversationHelpText, readConversation, recordUserAcceptanceConfirmation, renderConversationHistory } from './conversation.mjs';
import { decideCommand, shouldUseBriefChat } from './decision-cli.mjs';
import { clearCurrentRunState, readCurrentRunState, renderJobs, renderLogs } from './run-status.mjs';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'status';
const rest = command === 'status' && args[0]?.startsWith('--') ? args : args.slice(1);

main().catch((error) => {
  console.error('[agent] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  switch (command) {
    case 'start': return startCommand(rest);
    case 'status': return statusCommand();
    case 'jobs': return jobsCommand();
    case 'watch': return watchCommand(rest);
    case 'logs': return logsCommand(rest);
    case 'chat': return chatCommand(rest);
    case 'accept': return acceptCommand(rest);
    case 'decide': return decideCommand({ repoRoot, values: rest, rawInput: `npm run agent -- decide ${rest.join(' ')}` });
    case 'next': return nextCommand(rest);
    case 'verify-current':
    case 'gate':
      if ((command === 'gate' && rest[0] === '--current') || command === 'verify-current') return verifyCurrentCommand(rest);
      console.log('[agent] 使用: npm run agent -- verify-current 或 npm run agent -- gate --current');
      return;
    case 'doctor': return doctorCommand(rest);
    case 'help':
    case '--help':
    case '-h': return helpCommand();
    default:
      console.log(`[agent] unknown command: ${command}\n`);
      return helpCommand(1);
  }
}

async function startCommand(values) {
  const prdPath = firstPositional(values) || readOption(values, '--prd') || 'docs/prd/bossresume-full-refactor-prd.md';
  await ensureFileExists(prdPath);
  const forceReset = hasFlag(values, '--force-reset') || hasFlag(values, '--force');
  const explicitFeatureKey = readOption(values, '--feature');

  let existingState = null;
  try {
    existingState = await readWorkflowState(repoRoot);
  } catch {
    existingState = null;
  }

  if (existingState && existingState.phase && existingState.status !== 'DONE') {
    if (!forceReset) {
      console.log('[agent] 当前存在未完成的 Workflow。');
      console.log('');
      console.log(`  feature: ${existingState.featureKey}`);
      console.log(`  status: ${existingState.status || existingState.workflowStatus}`);
      console.log(`  phase: ${existingState.phase}`);
      console.log(`  round: ${existingState.round}`);
      console.log(`  failure_reason: ${existingState.failureReason || 'N/A'}`);
      console.log('');
      console.log('  使用 npm run agent -- status 查看当前状态。');
      console.log('');
      console.log('  如需强制重置：');
      console.log(`    npm run agent -- start ${prdPath} --feature=${existingState.featureKey} --force-reset`);
      console.log('');
      console.log('  --force-reset 会覆盖现有 Workflow 并重置 Round 为 0。');
      console.log('  只在确认要放弃当前流程并从头开始的情况下使用。');
      process.exit(1);
    }

    console.log(`[agent] 正在强制重置现有 Workflow: ${existingState.featureKey}`);
    await appendAuditEvent({
      repoRoot,
      event: 'workflow_force_reset',
      phase: existingState.phase,
      gate: existingState.gate,
      data: {
        previous_feature_key: existingState.featureKey,
        previous_phase: existingState.phase,
        previous_round: existingState.round,
        previous_status: existingState.status || existingState.workflowStatus,
        reset_reason: 'user_requested_force_reset',
      },
      message: `workflow_force_reset: ${existingState.featureKey} -> ${explicitFeatureKey || existingState.featureKey}`,
    });
  }

  const featureKey = explicitFeatureKey || (existingState?.featureKey) || deriveFeatureKey(prdPath) || 'bossresume-full-refactor';

  await initializeWorkflowState({ repoRoot, prdPath, featureKey });
  await clearCurrentRunState({ repoRoot, prdPath, featureKey, message: `Workflow initialized: feature=${featureKey}${forceReset ? ' (force reset)' : ''}。` });
  console.log(`[agent] workflow-state initialized with PRD: ${prdPath}`);
  console.log(`[agent] feature-key: ${featureKey}${forceReset ? ' (已强制重置)' : ''}`);
  console.log('[agent] 已清理上一轮 current-run/current-tasks 运行态。\n');
  await statusCommand();
}

async function statusCommand() {
  const card = await buildStatusCard(repoRoot);
  console.log(renderStatusCard(card));
}

async function jobsCommand() {
  console.log(await renderJobs({ repoRoot }));
}

async function logsCommand(values = []) {
  const raw = values.includes('raw') || values.includes('--raw');
  const lines = readNumberOption(values, '--lines', 80);
  console.log(await renderLogs({ repoRoot, raw, lines }));
}

async function watchCommand(values = []) {
  const intervalSeconds = readNumberOption(values, '--interval', 3);
  const noClear = hasFlag(values, '--no-clear');

  while (true) {
    if (!noClear) console.clear();
    console.log(await renderJobs({ repoRoot }));
    const { run } = await readCurrentRunState(repoRoot);
    const status = String(run?.status || '').toUpperCase();
    const step = String(run?.step || '').toUpperCase();
    if (!['RUNNING', 'GATE_CHECKING', 'PLANNED'].includes(status) && !['PLANNING', 'CREATING_WORKTREE', 'LAUNCHING_AGENT', 'WAITING_STATUS_JSON', 'GATE_CHECKING', 'SYNCING_OUTPUTS', 'UPDATING_STATE'].includes(step)) break;
    await sleep(intervalSeconds * 1000);
  }
}

async function chatCommand(values) {
  if (hasFlag(values, '--once')) return chatOnceCommand(values.filter((value) => value !== '--once'));
  if (hasFlag(values, '--tmux')) return chatInTmux(values.filter((value) => value !== '--tmux'));
  return interactiveChat(values);
}

async function chatOnceCommand(values) {
  const state = await readWorkflowState(repoRoot);
  const passThrough = [...values];
  if (!hasOption(passThrough, '--prd') && !hasOption(passThrough, '--init-prd')) passThrough.unshift(`--prd=${state.prdPath}`);
  return runNodeAndExit(['scripts/agent-loop/brain-chat.mjs', ...passThrough]);
}

async function interactiveChat(values) {
  const historyLimit = readNumberOption(values, '--history-limit', 20);
  console.log('BossResume Brain Agent 常驻对话框');
  console.log('');
  await statusCommand();
  console.log('');
  console.log(conversationHelpText());

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  rl.on('SIGINT', () => {
    console.log('\n输入 /exit 退出常驻对话框。');
    rl.prompt();
  });

  try {
    while (true) {
      const answer = await rl.question('\n你：');
      const text = answer.trim();
      if (!text) continue;

      const slash = parseSlashCommand(text);
      if (slash.command) {
        if (slash.command === '/exit' || slash.command === '/quit') {
          console.log('已退出 Brain Agent 常驻对话框。');
          break;
        }

        if (slash.command === '/help') {
          console.log(conversationHelpText());
          continue;
        }

        if (slash.command === '/status') {
          await statusCommand();
          continue;
        }

        if (slash.command === '/jobs') {
          await jobsCommand();
          continue;
        }

        if (slash.command === '/watch') {
          await watchCommand(slash.args);
          continue;
        }

        if (slash.command === '/logs') {
          await logsCommand(slash.args);
          continue;
        }

        if (slash.command === '/clear') {
          console.clear();
          await statusCommand();
          console.log('');
          console.log(conversationHelpText());
          continue;
        }

        if (slash.command === '/history') {
          const limit = readNumberOption(slash.args, '--limit', historyLimit);
          const entries = await readConversation({ repoRoot, limit });
          console.log(renderConversationHistory(entries, { limit }));
          continue;
        }

        if (slash.command === '/preview') {
          runNode(['scripts/agent-loop/orchestrator.mjs', ...slash.args, '--dry-run']);
          continue;
        }

        if (slash.command === '/doctor') {
          const prdOverride = readOption(slash.args, '--prd');
          const state = await safeReadWorkflowState();
          const prdPath = prdOverride || state?.prdPath || 'docs/prd/bossresume-full-refactor-prd.md';
          const passThrough = slash.args.filter((value) => !value.startsWith('--prd='));
          runNode(['scripts/agent-loop/verify.mjs', `--prd=${prdPath}`, ...passThrough]);
          continue;
        }

        if (slash.command === '/accept') {
          await acceptCommand(slash.args, { rawInput: text });
          continue;
        }

        if (slash.command === '/decide') {
          await decideCommand({ repoRoot, values: slash.args, rawInput: text });
          continue;
        }

        if (slash.command === '/next') {
          await runNextFromChat(slash.args);
          continue;
        }

        console.log(`[agent] unknown chat command: ${slash.command}. 输入 /help 查看可用命令。`);
        continue;
      }

      await runBrainTurn({ message: text, historyLimit });
    }
  } finally {
    rl.close();
  }
}

async function acceptCommand(values = [], { rawInput = null } = {}) {
  const state = await readWorkflowState(repoRoot);
  const phase = String(state.phase || '').toUpperCase();
  if (phase !== 'USER_ACCEPTANCE') {
    console.log(`[agent] 当前阶段是 ${state.phase}，不能记录用户验收确认。只有 USER_ACCEPTANCE 阶段允许使用 accept。`);
    process.exitCode = 1;
    return;
  }

  const nextRound = Number(state.round || 0) + 1;
  const round = readNumberOption(values, '--round', nextRound);
  const taskId = readOption(values, '--task-id') || buildUserAcceptanceTaskId({ featureKey: state.featureKey, round });
  const rawUserInput = rawInput || rawAcceptanceText(values) || '用户通过 CLI 明确确认验收通过。';
  const record = await recordUserAcceptanceConfirmation({ repoRoot, state, rawUserInput, round, taskId });

  await appendConversationEntry({
    repoRoot,
    role: 'user',
    content: rawUserInput,
    metadata: {
      command: 'accept',
      acceptance_decision_id: record.id,
      featureKey: record.feature_key,
      task_id: record.task_id,
      round: record.round,
      confirmed_at: record.confirmed_at,
    },
  });

  await writeWorkflowState({
    state,
    nextPhase: 'USER_ACCEPTANCE',
    nextRound: Number(state.round || 0),
    nextFailureCount: 0,
    nextGate: 'USER_ACCEPTANCE_GATE',
    nextGateStatus: 'DRAFT',
    nextAgent: 'brain_agent',
    ownerAgents: 'brain_agent',
    nextInstruction: `已记录用户验收确认。下一轮 USER_ACCEPTANCE 任务必须引用 CLI 写入的确认记录，task_id=${record.task_id}，round=${record.round}，confirmed_at=${record.confirmed_at}。请运行 npm run agent -- next 或在 chat 中输入 /next。`,
  });

  console.log('[agent] 已从 CLI 用户输入写入用户验收确认记录，并解除 USER_ACCEPTANCE 的 BLOCKED 状态。');
  console.log(`- decision id: ${record.id}`);
  console.log(`- feature_key: ${record.feature_key}`);
  console.log(`- task_id: ${record.task_id}`);
  console.log(`- round: ${record.round}`);
  console.log(`- confirmed_at: ${record.confirmed_at}`);
  console.log('[agent] 下一步：重新运行 /next 或 npm run agent -- next。');
}

async function runNextFromChat(values = []) {
  const state = await readWorkflowState(repoRoot);
  const card = await buildStatusCard(repoRoot, { state });
  console.log(renderStatusCard(card));
  console.log('');

  if (card.blocked) {
    if (card.workflowStatus === 'BLOCKED_BY_SYSTEM') {
      console.log('[agent] 当前属于系统阻塞，不需要用户业务决策。不要执行 chat/decide/next。请先修复 Agent Loop 控制面问题后执行 verify-current。');
      return;
    }
    console.log('[agent] 当前需要用户决策，请先继续和 Brain Agent 确认阻塞问题，或使用 /decide AUTO-xxx "决策内容" 记录明确决策。');
    return;
  }

  const foreground = hasFlag(values, '--foreground');
  const passThrough = values.filter((value) => value !== '--foreground');
  if (!allowMode(readOption(passThrough, '--mode'))) return;

  if (foreground) {
    runNode(['scripts/agent-loop/orchestrator.mjs', ...ensureModeArg(passThrough)]);
    console.log('');
    await statusCommand();
    return;
  }

  const child = runNodeBackground(['scripts/agent-loop/orchestrator.mjs', ...ensureModeArg(passThrough)]);
  console.log(`[agent] 已在后台启动 Agent Loop，进程 PID：${child.pid}`);
  console.log('[agent] 查看状态：/jobs；持续观察：/watch；查看结构化事件：/logs；查看原始日志：/logs raw');
}

async function runBrainTurn({ message, historyLimit }) {
  const state = await readWorkflowState(repoRoot);
  const brief = shouldUseBriefChat({ state, message });
  const args = [
    'scripts/agent-loop/brain-chat.mjs',
    `--prd=${state.prdPath}`,
    '--capture-output',
    '--quiet',
    `--history-limit=${historyLimit}`,
  ];
  if (brief) args.push('--brief');
  args.push(message);

  if (!brief) console.log('[agent] 当前处于 BLOCKED，本轮切换到 decision_chat，允许 Brain Agent 更新 confirmed-decisions/workflow-state。');
  const result = runNode(args);
  if (result.status !== 0) console.log(`[agent] Brain Agent 本轮退出码：${result.status}`);
}

async function chatInTmux(values) {
  const session = readOption(values, '--session') || 'boss-brain-agent';
  const passThrough = values.filter((value) => !value.startsWith('--session='));
  const command = ['npm', 'run', 'agent', '--', 'chat', ...passThrough].map(shellQuote).join(' ');
  const result = spawnSync('tmux', ['new-session', '-A', '-s', session, command], { cwd: repoRoot, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

async function nextCommand(values) {
  const state = await readWorkflowState(repoRoot);
  const card = await buildStatusCard(repoRoot, { state });
  console.log(renderStatusCard(card));
  console.log('');

  if (card.blocked) {
    if (card.workflowStatus === 'BLOCKED_BY_SYSTEM') {
      console.log('[agent] 当前属于系统阻塞，不需要用户业务决策。不要执行 chat/decide/next。请先修复 Agent Loop 控制面问题后执行 verify-current。');
      process.exit(1);
    }
    console.log('[agent] 当前需要用户决策，请先运行：npm run agent -- chat，或用 npm run agent -- decide AUTO-xxx "决策内容" 记录明确决策。');
    process.exit(1);
  }

  const preview = hasFlag(values, '--preview') || hasFlag(values, '--dry-run');
  const foreground = hasFlag(values, '--foreground');
  const passThrough = values.filter((value) => !['--preview', '--dry-run', '--background', '--foreground'].includes(value));
  if (!allowMode(readOption(passThrough, '--mode'))) {
    process.exitCode = 1;
    return;
  }

  const loopArgs = ['scripts/agent-loop/orchestrator.mjs', ...ensureModeArg(passThrough)];
  if (preview) loopArgs.push('--dry-run');

  if (preview || foreground) return runNodeAndExit(loopArgs);

  const child = runNodeBackground(loopArgs);
  console.log(`[agent] 已在后台启动 Agent Loop，进程 PID：${child.pid}`);
  console.log('[agent] 查看状态：npm run agent -- jobs；持续观察：npm run agent -- watch；查看结构化事件：npm run agent -- logs；查看原始日志：npm run agent -- logs raw');
}

async function doctorCommand(values) {
  const prdOverride = readOption(values, '--prd');
  const state = await safeReadWorkflowState();
  const prdPath = prdOverride || state?.prdPath || 'docs/prd/bossresume-full-refactor-prd.md';
  const passThrough = values.filter((value) => !value.startsWith('--prd='));
  return runNodeAndExit(['scripts/agent-loop/verify.mjs', `--prd=${prdPath}`, ...passThrough]);
}

async function verifyCurrentCommand(values) {
  const state = await safeReadWorkflowState();
  if (!state || !state.featureKey) {
    console.log('[agent] No active workflow state found. Cannot reverify.');
    process.exit(1);
  }

  console.log(`[agent] Verifying existing artifacts for feature: ${state.featureKey}`);
  console.log(`[agent] Phase: ${state.phase} | Gate: ${state.gate} | Round: ${state.round}`);
  console.log('[agent] This will NOT start any Agent. Only existing artifacts will be re-evaluated.\n');

  const passThrough = values.filter((value) => value !== '--current');
  return runNodeAndExit(['scripts/agent-loop/verify-current.mjs', ...passThrough]);
}

function helpCommand(exitCode = 0) {
  console.log(`BossResume Agent CLI

用户日常命令：
  npm run agent -- start docs/prd/bossresume-full-refactor-prd.md
  npm run agent -- status
  npm run agent -- jobs
  npm run agent -- watch
  npm run agent -- logs
  npm run agent -- logs raw
  npm run agent -- chat
  npm run agent -- chat --once "你的问题"
  npm run agent -- chat --tmux
  npm run agent -- next --preview
  npm run agent -- next
  npm run agent -- next --foreground
  npm run agent -- next --mode=single
  npm run agent -- next --mode=auto --max-loops=10
  npm run agent -- verify-current
  npm run agent -- gate --current
  npm run agent -- decide AUTO-003 "你的决策内容"
  npm run agent -- accept "验收通过"
  npm run agent -- doctor

常驻对话框命令：
  /status   查看当前状态
  /jobs     查看当前运行任务
  /watch    持续刷新运行状态
  /logs     查看结构化事件，可用 /logs raw 查看原始日志
  /preview  预览下一轮 Agent，例如 /preview --fresh-worktree
  /next     后台执行下一轮 Agent Loop，例如 /next --fresh-worktree；前台执行用 /next --foreground
  /decide   BLOCKED 阶段记录用户决策，例如 /decide AUTO-003 "投递后 7 天自动标记，允许手动撤销"
  /accept   USER_ACCEPTANCE 阶段记录用户验收确认，例如 /accept 验收通过
  /doctor   系统自检
  /history  查看最近对话，可用 /history --limit=50
  /exit     退出

执行模式：
  --mode=auto      自动推进到通过、需要用户决策或达到安全上限（需显式指定，不会默认进入 auto）
  --mode=single    只执行一轮（默认模式）
  --mode=cautious  等同单轮，用于审慎推进

高级维护命令仍然保留：
  npm run agent:brain
  npm run agent:state
  npm run agent:loop
  npm run agent:loop:dry-run
  npm run agent:loop:verify
`);
  process.exit(exitCode);
}

async function safeReadWorkflowState() {
  try {
    return await readWorkflowState(repoRoot);
  } catch {
    return null;
  }
}

async function ensureFileExists(relativePath) {
  await access(path.join(repoRoot, relativePath));
}

function runNodeAndExit(nodeArgs) {
  const result = runNode(nodeArgs);
  process.exit(result.status ?? 1);
}

function runNode(nodeArgs) {
  return spawnSync('node', nodeArgs, { cwd: repoRoot, stdio: 'inherit' });
}

function runNodeBackground(nodeArgs) {
  const child = spawn('node', nodeArgs, { cwd: repoRoot, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

function ensureModeArg(values) {
  if (hasOption(values, '--mode')) return values;
  return [...values, '--mode=single'];
}

function allowMode(modeFromArgs) {
  const mode = normalizeModeFromCli(modeFromArgs || 'single');
  if (mode !== 'auto') return true;

  console.log('[agent] AUTO mode unavailable.');
  console.log('');
  console.log('  Auto 模式需要在 P1 能力接入完成后才允许：');
  console.log('  - task_context_package（最小上下文封装）');
  console.log('  - worktree_manifest（输入校验与启动前拦截）');
  console.log('  - current_artifact_reverify（当前产物重新验证）');
  console.log('  - 至少两次稳定 Single 执行');
  console.log('');
  console.log('  当前请使用：');
  console.log('    npm run agent -- next --mode=single');
  console.log('');
  return false;
}

function normalizeModeFromCli(value) {
  const normalized = String(value || 'single').trim().toLowerCase().replace(/[ -]/g, '_');
  if (['single', 'cautious', 'auto'].includes(normalized)) return normalized;
  return 'single';
}

function firstPositional(values) {
  return values.find((value) => !value.startsWith('--')) || null;
}

function rawAcceptanceText(values) {
  return values.filter((value) => !value.startsWith('--round=') && !value.startsWith('--task-id=')).join(' ').trim();
}

function hasFlag(values, name) {
  return values.includes(name);
}

function hasOption(values, name) {
  return values.some((value) => value === name || value.startsWith(`${name}=`));
}

function readOption(values, name) {
  const prefix = `${name}=`;
  const item = values.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function readNumberOption(values, name, fallback) {
  const raw = readOption(values, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSlashCommand(value) {
  if (!value.startsWith('/')) return { command: null, args: [] };
  const parts = splitArgs(value);
  return { command: parts[0] || null, args: parts.slice(1) };
}

function splitArgs(value) {
  return String(value || '')
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    ?.map(unquote) || [];
}

function unquote(value) {
  const text = String(value || '');
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function deriveFeatureKey(value) {
  if (!value) return null;
  const base = path.basename(value).replace(/\.md$/i, '');
  return base.replace(/-prd$/i, '') || null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
