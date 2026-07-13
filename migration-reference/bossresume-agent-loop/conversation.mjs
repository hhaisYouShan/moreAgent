import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BEIJING_TIME_LABEL, BEIJING_TIME_ZONE, formatBeijingRunId, formatBeijingTimestamp } from './time.mjs';

export const CONVERSATION_PATH = 'agent-loop-docs/process/brain-conversation.jsonl';
export const CONFIRMED_DECISIONS_PATH = 'agent-loop-docs/process/confirmed-decisions.json';
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_ENTRY_CHARS_FOR_PROMPT = 2400;
const MAX_RENDERED_CHARS_FOR_PROMPT = 16000;

export async function readConversation({ repoRoot, limit = DEFAULT_HISTORY_LIMIT } = {}) {
  const filePath = path.join(repoRoot || process.cwd(), CONVERSATION_PATH);
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);

  return limit > 0 ? entries.slice(-limit) : entries;
}

export async function readConfirmedDecisions({ repoRoot } = {}) {
  const filePath = path.join(repoRoot || process.cwd(), CONFIRMED_DECISIONS_PATH);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(parsed.decisions) ? parsed.decisions : [];
  } catch {
    return [];
  }
}

export async function ensureConfirmedDecisionsFile({ repoRoot } = {}) {
  const filePath = path.join(repoRoot || process.cwd(), CONFIRMED_DECISIONS_PATH);
  try {
    await readFile(filePath, 'utf8');
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ decisions: [] }, null, 2)}\n`, 'utf8');
  }
}

export async function recordUserAcceptanceConfirmation({ repoRoot, state, rawUserInput, round, taskId } = {}) {
  const root = repoRoot || process.cwd();
  const featureKey = String(state?.featureKey || '').trim();
  const acceptanceRound = Number(round || state?.round || 0);
  const acceptanceTaskId = String(taskId || buildUserAcceptanceTaskId({ featureKey, round: acceptanceRound })).trim();

  if (!featureKey) throw new Error('无法记录用户验收：workflow-state 缺少 feature-key。');
  if (!Number.isInteger(acceptanceRound) || acceptanceRound <= 0) throw new Error('无法记录用户验收：缺少有效 round。请使用 /accept --round=N。');
  if (!acceptanceTaskId) throw new Error('无法记录用户验收：缺少 USER_ACCEPTANCE task_id。');

  const confirmedAt = `${formatBeijingTimestamp()} 北京时间`;
  const record = {
    id: `user-acceptance-${featureKey}-round-${acceptanceRound}-${formatBeijingRunId()}`,
    type: 'USER_ACCEPTANCE',
    feature_key: featureKey,
    task_id: acceptanceTaskId,
    acceptance_task_id: acceptanceTaskId,
    round: acceptanceRound,
    user_confirmed: true,
    confirmed_by: 'user',
    source: 'user',
    source_channel: 'agent_cli',
    status: 'CONFIRMED',
    confirmed_at: confirmedAt,
    timeZone: BEIJING_TIME_ZONE,
    timeLabel: BEIJING_TIME_LABEL,
    raw_user_input: String(rawUserInput || '').trim(),
    note: 'This record was written by scripts/agent-loop/cli.mjs from raw user CLI input, not generated freely by the model.',
  };

  await appendDecisionRecordAtRoot({ root, record });
  await mirrorDecisionRecordToTaskWorktree({ repoRoot: root, taskId: acceptanceTaskId, record });
  return record;
}

export function buildUserAcceptanceTaskId({ featureKey, round }) {
  return `${featureKey}-user-acceptance-round-${round}`;
}

export async function appendConversationEntry({ repoRoot, role, content, metadata = {} }) {
  const normalizedContent = String(content || '').trim();
  if (!normalizedContent) return null;

  const root = repoRoot || process.cwd();
  const filePath = path.join(root, CONVERSATION_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });

  const entry = {
    time: formatBeijingTimestamp(),
    timeZone: BEIJING_TIME_ZONE,
    timeLabel: BEIJING_TIME_LABEL,
    role: normalizeRole(role),
    content: normalizedContent,
    ...metadata,
  };

  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  await mirrorConversationEntryToTaskWorktree({ repoRoot: root, entry });
  return entry;
}

export function renderRecentConversation(entries, { maxChars = MAX_RENDERED_CHARS_FOR_PROMPT } = {}) {
  if (!entries?.length) return '暂无历史对话。';

  const chunks = [];
  let size = 0;

  for (const entry of entries) {
    const chunk = renderConversationEntry(entry, { compact: false });
    size += chunk.length;
    chunks.push(chunk);

    while (size > maxChars && chunks.length > 1) {
      size -= chunks.shift().length;
    }
  }

  return chunks.join('\n\n');
}

export function renderConfirmedDecisions(decisions, { limit = 20 } = {}) {
  const recent = Array.isArray(decisions) ? decisions.slice(-limit) : [];
  if (!recent.length) return '暂无已确认决策。';
  return recent
    .map((item, index) => {
      const id = item.id || `decision-${index + 1}`;
      const status = item.status || 'CONFIRMED';
      const decision = item.decision || item.content || item.summary || item.type || JSON.stringify(item);
      const source = item.source || item.time || 'N/A';
      const task = item.task_id ? ` task_id=${item.task_id}` : '';
      const issue = item.issue_id ? ` issue_id=${item.issue_id}` : '';
      return `- ${id} [${status}] ${decision}${task}${issue}（source: ${source}）`;
    })
    .join('\n');
}

export function renderConversationHistory(entries, { limit = DEFAULT_HISTORY_LIMIT } = {}) {
  const recent = limit > 0 ? entries.slice(-limit) : entries;
  if (!recent.length) return '暂无历史对话。';
  return recent.map((entry) => renderConversationEntry(entry, { compact: true })).join('\n\n');
}

export function conversationHelpText() {
  return [
    '可用命令：',
    '/status   查看当前状态卡',
    '/jobs     查看当前运行任务',
    '/watch    持续刷新运行状态',
    '/logs     查看结构化事件；可用 /logs raw 查看原始日志',
    '/preview  预览下一轮 Agent，不真正执行；可用 /preview --fresh-worktree',
    '/next     后台执行下一轮 Agent Loop；旧 worktree 时用 /next --fresh-worktree；前台执行用 /next --foreground',
    '/decide   BLOCKED 阶段记录用户决策，例如 /decide AUTO-003 "投递后 7 天自动标记，允许手动撤销"',
    '/accept   仅在 USER_ACCEPTANCE 阶段使用；从当前 CLI 用户输入直接写入用户验收确认记录，例如 /accept 验收通过',
    '/doctor   执行系统自检',
    '/history  查看最近对话；可用 /history --limit=50',
    '/clear    清屏并重新显示状态',
    '/help     查看命令帮助',
    '/exit     退出常驻对话框',
    `时间规则：所有用户可见时间默认使用 ${BEIJING_TIME_LABEL}`,
  ].join('\n');
}

async function appendDecisionRecordAtRoot({ root, record }) {
  const filePath = path.join(root, CONFIRMED_DECISIONS_PATH);
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
}

async function mirrorDecisionRecordToTaskWorktree({ repoRoot, taskId, record }) {
  const worktreePath = path.join(repoRoot, '.agent-worktrees', taskId);
  if (!existsSync(worktreePath)) return;
  await appendDecisionRecordAtRoot({ root: worktreePath, record });
}

async function mirrorConversationEntryToTaskWorktree({ repoRoot, entry }) {
  if (entry?.command !== 'accept' || !entry.task_id) return;
  const worktreePath = path.join(repoRoot, '.agent-worktrees', entry.task_id);
  if (!existsSync(worktreePath)) return;

  const filePath = path.join(worktreePath, CONVERSATION_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function renderConversationEntry(entry, { compact }) {
  const role = normalizeRole(entry.role);
  const title = role === 'user' ? '用户' : role === 'brain_agent' ? '主 Agent' : role;
  const time = entry.time || '未知时间';
  const content = clipText(entry.content, compact ? 1200 : MAX_ENTRY_CHARS_FOR_PROMPT);
  return `[${time}] ${title}:\n${content}`;
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'assistant' || value === 'brain' || value === 'brain_agent') return 'brain_agent';
  if (value === 'user') return 'user';
  if (value === 'system') return 'system';
  return value || 'unknown';
}

function clipText(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...（已截断）`;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
