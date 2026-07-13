import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BEIJING_TIME_LABEL, BEIJING_TIME_ZONE, formatBeijingTimestamp } from './time.mjs';

export const AUDIT_EVENTS_PATH = 'agent-loop-docs/process/audit-events.jsonl';

export async function appendAuditEvent({ repoRoot = process.cwd(), event, level = 'info', runId = null, phase = null, gate = null, taskId = null, agent = null, data = {}, message = null } = {}) {
  if (!event) return null;
  const record = {
    event,
    level,
    run_id: runId,
    phase,
    gate,
    task_id: taskId,
    agent,
    timestamp: `${formatBeijingTimestamp()} ${BEIJING_TIME_LABEL}`,
    time_zone: BEIJING_TIME_ZONE,
    message,
    ...sanitizeData(data),
  };

  const filePath = path.join(repoRoot, AUDIT_EVENTS_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readAuditEvents({ repoRoot = process.cwd(), limit = 80 } = {}) {
  const filePath = path.join(repoRoot, AUDIT_EVENTS_PATH);
  if (!existsSync(filePath)) return [];
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function summarizeStateForAudit(state = {}) {
  return {
    phase: state.phase || null,
    gate: state.gate || null,
    gate_status: state.gateStatus || state.gate_status || null,
    status: state.status || state.workflowStatus || null,
    step: state.step || null,
    failure_count: Number(state.failureCount || state.failure_count || 0),
    retry_count: Number(state.retryCount || state.retry_count || state.failureCount || 0),
    failure_reason: state.failureReason || state.failure_reason || null,
    next_agent: state.nextAgent || state.next_agent || state.activeAgent || state.active_agent || null,
    owner_agents: state.ownerAgents || state.owner_agents || state.ownerAgent || state.owner_agent || null,
    product_prd_edit_mode: state.productPrdEditMode || state.product_prd_edit_mode || null,
  };
}

function sanitizeData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
