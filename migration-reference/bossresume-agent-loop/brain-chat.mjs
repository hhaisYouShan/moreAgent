#!/usr/bin/env node
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { initializeWorkflowState, readWorkflowState, reconcileWorkflowStateFromMarkdown } from './state.mjs';
import { buildStatusCard, renderStatusCard } from './status.mjs';
import { appendConversationEntry, ensureConfirmedDecisionsFile, readConfirmedDecisions, readConversation, renderConfirmedDecisions, renderRecentConversation } from './conversation.mjs';
import { runPreflight, formatPreflight } from './preflight.mjs';
import { BEIJING_TIME_LABEL, formatBeijingRunId } from './time.mjs';

const args = process.argv.slice(2);
const repoRoot = process.cwd();
const dryRun = hasFlag('--dry-run');
const captureOutput = hasFlag('--capture-output');
const quiet = hasFlag('--quiet');
const brief = hasFlag('--brief');
const formalReport = hasFlag('--formal-report');
const skipHistory = hasFlag('--no-history');
const historyLimit = readNumberOption('--history-limit', 20);
const initPrdPath = readOption('--init-prd');
const discussionPrdPath = readOption('--prd');
const prdPath = initPrdPath || discussionPrdPath;
const featureKey = readOption('--feature') || deriveFeatureKey(prdPath) || 'bossresume-full-refactor';
const engine = normalizeEngine(readOption('--engine') || process.env.AGENT_LOOP_ENGINE || 'opencode');
const model = resolveModel(engine);
const runId = formatBeijingRunId(new Date());
const runDir = path.join(repoRoot, '.agent-runs', runId, 'brain-chat');
const userMessage = positionalArgs().join(' ').trim() || '请基于当前 workflow-state 和 PRD，判断下一步应该怎么推进。不要启动子 Agent，只给出建议、问题和下一步命令。';

main().catch((error) => {
  console.error('[主 Agent] 执行失败');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  const preflight = runPreflight({
    repoRoot,
    requireTmux: false,
    requireWarp: false,
    requireCodex: engine === 'codex',
    requireOpenCode: engine === 'opencode',
  });

  if (!quiet) {
    console.log('[主 Agent] 环境检查');
    console.log(formatPreflight(preflight));
  }

  if (!dryRun && !preflight.ok) throw new Error('环境检查未通过。请先安装缺失工具，再运行主 Agent。');
  if (prdPath) await ensureFileExists(prdPath);
  await ensureConfirmedDecisionsFile({ repoRoot });

  if (initPrdPath) {
    if (dryRun) console.log(`[主 Agent] dry-run：将会用 PRD 初始化 workflow-state：${initPrdPath}`);
    else {
      await initializeWorkflowState({ repoRoot, prdPath: initPrdPath, featureKey });
      if (!quiet) console.log(`[主 Agent] 已用以下 PRD 初始化 workflow-state：${initPrdPath}`);
    }
  } else if (discussionPrdPath && !quiet) {
    console.log(`[主 Agent] 已检查本次讨论 PRD，不会重置 workflow-state：${discussionPrdPath}`);
  }

  const state = await readWorkflowState(repoRoot);
  const statusCard = await buildStatusCard(repoRoot, { state });
  const statusText = renderStatusCard(statusCard);
  const recentConversation = skipHistory ? [] : await readConversation({ repoRoot, limit: historyLimit });
  const recentConversationText = renderRecentConversation(recentConversation);
  const confirmedDecisions = await readConfirmedDecisions({ repoRoot });
  const confirmedDecisionsText = renderConfirmedDecisions(confirmedDecisions);
  const prompt = brief
    ? renderBriefBrainPrompt({ state, statusCard, recentConversationText, confirmedDecisionsText, userMessage })
    : await renderBrainPrompt({ state, statusText, recentConversationText, confirmedDecisionsText, userMessage, discussionPrdPath, formalReport });

  if (!quiet) {
    console.log('');
    console.log(statusText);
    console.log('');
    console.log('[主 Agent] 运行信息');
    console.log(`- 引擎：${engine}`);
    console.log(`- 模型：${model}`);
    console.log('- 模式：仅讨论，不会启动子 Agent');
    console.log(`- 对话历史：${skipHistory ? '未加载' : `已加载 ${recentConversation.length} 条`}`);
    console.log(`- 已确认决策：${confirmedDecisions.length} 条`);
    console.log(`- 时间规则：${BEIJING_TIME_LABEL}`);
    console.log(`- 聊天模式：${brief ? '轻量聊天' : formalReport ? '正式报告' : '决策聊天'}`);
  }

  if (dryRun) {
    console.log('\n[主 Agent] dry-run 完成。没有真正启动主 Agent 进程。');
    return;
  }

  await mkdir(runDir, { recursive: true });
  const promptPath = path.join(runDir, 'prompt.md');
  await writeFile(promptPath, prompt, 'utf8');
  if (!brief) await appendDiscussionHeader({ state, userMessage, promptPath, discussionPrdPath });
  await appendConversationEntry({
    repoRoot,
    role: 'user',
    content: userMessage,
    metadata: {
      runId,
      featureKey: state.featureKey,
      phase: state.phase,
      gate: state.gate,
      gateStatus: state.gateStatus,
      prdPath: state.prdPath,
      mode: brief ? 'brief' : formalReport ? 'formal_report' : 'decision_chat',
    },
  });

  if (!quiet) console.log(`\n[主 Agent] 本轮 Prompt：${path.relative(repoRoot, promptPath)}`);
  const result = captureOutput ? await runAgentAndCapture(prompt) : { exitCode: await runAgent(prompt), output: '' };

  if (captureOutput) {
    await appendConversationEntry({
      repoRoot,
      role: 'brain_agent',
      content: clipForConversation(result.output || `主 Agent 已结束，退出码：${result.exitCode}。`),
      metadata: {
        runId,
        featureKey: state.featureKey,
        phase: state.phase,
        gate: state.gate,
        gateStatus: state.gateStatus,
        prdPath: state.prdPath,
        exitCode: result.exitCode,
        mode: brief ? 'brief' : formalReport ? 'formal_report' : 'decision_chat',
      },
    });
  }

  const reconciliation = await reconcileWorkflowStateFromMarkdown({ repoRoot, actor: 'brain_agent', reason: 'brain_chat_completed' });
  if (reconciliation.reconciled && !quiet) {
    console.log('[主 Agent] 已检测到 workflow-state.md 与 workflow-state.json 不一致，并通过统一状态写入函数完成同步。');
  }

  process.exit(result.exitCode);
}

function renderBriefBrainPrompt({ state, statusCard, recentConversationText, confirmedDecisionsText, userMessage }) {
  return `你是 bossResume 的主 Agent。现在是普通聊天模式，不是正式 Gate 产物。\n\n用户问题：\n${userMessage}\n\n当前状态：\n- PRD：${state.prdPath}\n- 阶段：${state.phase}\n- Gate：${state.gate} / ${state.gateStatus}\n- 下一步 Agent：${state.nextAgent || statusCard.nextAgent || 'N/A'}\n- Issue Owner：${state.ownerAgents || statusCard.ownerAgents || 'N/A'}\n- 是否阻塞：${statusCard.blocked ? '是' : '否'}\n- 推荐命令：${statusCard.recommendedCommand}\n\n已确认决策：\n${confirmedDecisionsText}\n\n最近对话摘要：\n${recentConversationText}\n\n回答规则：\n1. 只用中文。\n2. 不要输出 Self Check。\n3. 不要打印环境检查、Prompt 路径、长状态卡。\n4. 不要修改任何文件。\n5. 不要启动子 Agent。\n6. 回答控制在 3 到 6 行。\n7. 已确认决策优先级高于历史聊天。\n8. 只有确实需要用户做业务、产品、数据库、架构取舍时，才说“需要你决策”。\n9. USER_ACCEPTANCE 用户验收确认只能提示用户执行 /accept 或 npm run agent -- accept，不要让模型写 confirmed-decisions.json。\n\n推荐输出格式：\n当前在：...\n问题归属：...\n是否需要你决策：是/否\n下一步：...\n`;
}

async function renderBrainPrompt({ state, statusText, recentConversationText, confirmedDecisionsText, userMessage, discussionPrdPath, formalReport }) {
  const brainPrompt = await readFile(path.join(repoRoot, 'scripts/agent-loop/agents/brain-agent.md'), 'utf8');
  const effectivePrdPath = discussionPrdPath || state.prdPath || 'docs/prd/bossresume-full-refactor-prd.md';
  const requiredFiles = [
    'AGENTS.md',
    'docs/README.md',
    'agent-loop-docs/process/workflow-state.md',
    'agent-loop-docs/process/workflow-state.json',
    'agent-loop-docs/process/round-context.json',
    'agent-loop-docs/process/agent-registry.md',
    'agent-loop-docs/process/gate-matrix.md',
    'agent-loop-docs/process/brain-loop-protocol.md',
    'agent-loop-docs/process/prd-review-standard.md',
    'agent-loop-docs/process/confirmed-decisions.json',
    'agent-loop-docs/process/audit-events.jsonl',
    effectivePrdPath,
    'agent-loop-docs/process/brain-discussion.md',
  ];

  const outputFormat = formalReport
    ? '- 当前判断\n- 当前状态卡摘要\n- 需要你确认的问题\n- 建议下一步\n- 是否建议执行下一步：是/否\n- 推荐命令\n- Self Check'
    : '- 当前判断\n- 是否需要用户决策：是/否\n- 关键依据\n- 下一步命令';

  return `${brainPrompt}\n\n---\n\n# 运行时主 Agent 讨论\n\n你现在不是执行子 Agent 的 orchestrator，而是用户可以持续对话的主 Agent / 总大脑。\n\n## 用户输入\n\n${userMessage}\n\n## 当前状态卡\n\n\`\`\`text\n${statusText}\n\`\`\`\n\n## 已确认决策\n\n\`\`\`text\n${confirmedDecisionsText}\n\`\`\`\n\n## 最近主 Agent 对话\n\n\`\`\`text\n${recentConversationText}\n\`\`\`\n\n## 当前流程状态\n\n- feature-key: ${state.featureKey}\n- workflow PRD path: ${state.prdPath}\n- discussion PRD path: ${discussionPrdPath || 'N/A'}\n- phase: ${state.phase}\n- round: ${state.round}\n- gate: ${state.gate}\n- gate status: ${state.gateStatus}\n- next agent: ${state.nextAgent || 'N/A'}\n- owner agents: ${state.ownerAgents || 'N/A'}\n- time rule: ${BEIJING_TIME_LABEL}\n\n## 必读输入\n\n回答或更新文档前，先阅读这些文件：\n\n${unique(requiredFiles).map((file) => `- ${file}`).join('\n')}\n\n## 允许写入范围\n\n除非用户明确要求更多，否则你只允许更新这些文件：\n\n- agent-loop-docs/process/brain-discussion.md\n- agent-loop-docs/process/confirmed-decisions.json\n\n## Workflow 状态写入规则\n\n1. \`agent-loop-docs/process/workflow-state.json\` 是唯一机器事实源。\n2. 不要只手动编辑 \`workflow-state.md\` 来推进流程；这会造成展示层和机器事实源分裂。\n3. 如确实需要推进 workflow 状态，必须在回答中明确说明“需要统一状态写入”，并让 CLI 的 brain-chat finalizer 通过 \`writeWorkflowState()\` 同步 Markdown / JSON / round-context。\n4. 如果你发现 \`workflow-state.md\` 和 \`workflow-state.json\` 不一致，必须判断为系统状态分裂，不要继续让用户做业务决策。\n\n## 硬性规则\n\n1. 不要运行或启动子 Agent。\n2. 不要修改业务代码。\n3. 除非用户明确要求，不要修改 PRD、技术方案、Review、Issue、Decision、client 或 server 文件。\n4. PRD 或 workflow-state 不清楚时，必须提出简洁问题，并把“是否建议执行下一步”标记为“否”。\n5. 下一步清楚时，只提供用户应该执行的命令，不要自己执行。常驻对话框内优先建议 /preview 或 /next。\n6. 将讨论摘要、待确认问题和推荐下一步命令追加到 agent-loop-docs/process/brain-discussion.md。\n7. 已确认决策是事实来源，优先级高于最近主 Agent 对话；最近对话只作为上下文连续性参考。\n8. 当用户明确确认普通产品、技术、流程或范围决策时，可以写入 agent-loop-docs/process/confirmed-decisions.json；但 USER_ACCEPTANCE 用户验收确认记录只能由 /accept 或 npm run agent -- accept 从用户原始输入直接写入，模型不得自由生成。\n9. USER_ACCEPTANCE 阶段需要用户验收通过时，只能提示用户执行 /accept 验收通过 或 npm run agent -- accept \"验收通过\"。\n10. 所有用户可见内容尽量使用中文。\n11. 所有用户可见时间、运行时间、更新时间必须使用 ${BEIJING_TIME_LABEL}。\n12. 只有 --formal-report 模式才输出 Self Check；普通决策聊天不要输出 Self Check。\n\n## 必须使用的回答格式\n\n${outputFormat}\n`;
}

async function appendDiscussionHeader({ state, userMessage, promptPath, discussionPrdPath }) {
  const discussionPath = path.join(repoRoot, 'agent-loop-docs/process/brain-discussion.md');
  const header = `\n\n## ${runId} 主 Agent 会话\n\n- feature-key: \`${state.featureKey}\`\n- workflow PRD: \`${state.prdPath}\`\n- discussion PRD: \`${discussionPrdPath || 'N/A'}\`\n- phase: \`${state.phase}\`\n- time rule: \`${BEIJING_TIME_LABEL}\`\n- prompt: \`${path.relative(repoRoot, promptPath)}\`\n- user message: ${userMessage}\n`;

  try {
    await access(discussionPath);
    await appendFile(discussionPath, header, 'utf8');
  } catch {
    await writeFile(discussionPath, `# 主 Agent 讨论记录\n\n这个文件记录你和主 Agent 的讨论结论、阻塞问题、下一步命令和流程状态变更。所有用户可见时间默认使用 ${BEIJING_TIME_LABEL}。${header}`, 'utf8');
  }
}

function runAgent(prompt) {
  const { command, commandArgs } = agentCommand(prompt);

  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: repoRoot, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`[主 Agent] 启动 ${command} 失败：${error.message}`);
      resolve(1);
    });
  });
}

function runAgentAndCapture(prompt) {
  const { command, commandArgs } = agentCommand(prompt);

  return new Promise((resolve) => {
    let output = '';
    const child = spawn(command, commandArgs, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
    child.on('error', (error) => {
      const message = `[主 Agent] 启动 ${command} 失败：${error.message}`;
      console.error(message);
      resolve({ exitCode: 1, output: message });
    });
  });
}

function agentCommand(prompt) {
  const command = engine === 'opencode' ? 'opencode' : 'codex';
  const commandArgs = engine === 'opencode'
    ? ['run', '--dir', repoRoot, '--model', model, '--auto', prompt]
    : ['-C', repoRoot, '-m', model, '-s', 'workspace-write', '-a', 'never', 'exec', prompt];

  return { command, commandArgs };
}

async function ensureFileExists(relativePath) {
  await access(path.join(repoRoot, relativePath));
}

function readOption(name) {
  const prefix = `${name}=`;
  const item = args.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function readNumberOption(name, fallback) {
  const value = readOption(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function positionalArgs() {
  return args.filter((value) => !value.startsWith('--'));
}

function normalizeEngine(value) {
  return String(value || 'opencode').trim().toLowerCase() === 'codex' ? 'codex' : 'opencode';
}

function resolveModel(selectedEngine) {
  if (selectedEngine === 'opencode') return process.env.AGENT_LOOP_OPENCODE_MODEL || process.env.AGENT_LOOP_MODEL || 'deepseek/deepseek-v4-pro';
  return process.env.AGENT_LOOP_CODEX_MODEL || process.env.AGENT_LOOP_MODEL || 'gpt-5.5';
}

function deriveFeatureKey(value) {
  if (!value) return null;
  const base = path.basename(value).replace(/\.md$/i, '');
  return base.replace(/-prd$/i, '') || null;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function clipForConversation(value) {
  const text = String(value || '').trim();
  const max = 16000;
  return text.length <= max ? text : `${text.slice(0, max)}\n...（输出过长，已截断）`;
}
