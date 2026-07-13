import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function readAdapter(adapterPath) {
  const adapter = await readJsonFile(adapterPath);
  if (!adapter?.project?.id || !adapter?.paths?.workflowJson || !adapter?.paths?.workflowMarkdown || !adapter?.paths?.roundContext) {
    throw new Error(`Invalid adapter: ${adapterPath}`);
  }
  return adapter;
}

export async function inspectStateSources({ projectRoot, adapter }) {
  const workflow = await readJsonAt(projectRoot, adapter.paths.workflowJson);
  const markdown = await readTextAt(projectRoot, adapter.paths.workflowMarkdown);
  const roundContext = await readJsonAt(projectRoot, adapter.paths.roundContext);
  const currentRun = await readJsonAt(projectRoot, adapter.paths.currentRun);
  const currentTasks = await readJsonAt(projectRoot, adapter.paths.currentTasks);
  const currentEvents = await readTextAt(projectRoot, adapter.paths.currentEvents);
  const workflowState = normalizeWorkflow(workflow, adapter);
  const markdownState = markdown ? parseMarkdown(markdown, adapter) : null;
  const roundState = normalizeRoundContext(roundContext, adapter);
  const activeTaskIds = Array.isArray(currentTasks?.tasks)
    ? currentTasks.tasks.map((task) => String(task?.[adapter.runtime.taskIdField] || '')).filter(Boolean)
    : [];
  const references = collectReferences({ currentRun, currentTasks, adapter });
  const missingArtifacts = references.filter((reference) => !existsSync(path.join(projectRoot, reference)));
  const worktrees = inspectWorktrees({ projectRoot, agentWorktrees: adapter.paths.agentWorktrees, activeTaskIds });
  const reasons = [
    !workflowState || !markdownState || differs(workflowState, markdownState, adapter.criticalFields) ? 'workflow_markdown_mismatch' : null,
    !workflowState || !roundState || differs(workflowState, roundState, adapter.criticalFields) ? 'round_context_mismatch' : null,
    unexpectedRun({ currentRun, workflowState, adapter }) ? 'workflow_run_mismatch' : null,
    missingArtifacts.length ? 'missing_artifact_references' : null,
    worktrees.prunable.length ? 'prunable_worktrees' : null,
    worktrees.orphan.length ? 'orphan_worktrees' : null,
  ].filter(Boolean);

  return {
    schemaVersion: '1.0',
    project: adapter.project.id,
    splitDetected: reasons.length > 0,
    workflow: workflowState,
    markdownWorkflow: markdownState,
    roundContext: roundState,
    currentRun: summarizeRun(currentRun, adapter),
    currentTaskCount: activeTaskIds.length,
    currentEventsPresent: Boolean(currentEvents.trim()),
    artifactReferences: references,
    missingArtifacts,
    worktrees,
    reasons,
    nextBoundary: adapter.m0?.message || null,
  };
}

function normalizeWorkflow(value, adapter) {
  if (!value) return null;
  const fields = adapter.fields;
  return Object.fromEntries(Object.entries(fields).map(([canonical, source]) => [canonical, value[source] ?? null]));
}

function normalizeRoundContext(value, adapter) {
  if (!value) return null;
  const fields = adapter.roundContextFields || adapter.fields;
  return Object.fromEntries(Object.entries(adapter.fields).map(([canonical]) => [canonical, value[fields[canonical]] ?? null]));
}

function parseMarkdown(content, adapter) {
  const result = {};
  for (const [canonical, expression] of Object.entries(adapter.markdownPatterns || {})) {
    const match = content.match(new RegExp(expression, 'm'));
    const value = match?.[1]?.trim() || null;
    result[canonical] = adapter.nullValues?.includes(String(value)) ? null : value;
  }
  return result;
}

function differs(left, right, fields) {
  return fields.some((field) => String(left[field] ?? '') !== String(right[field] ?? ''));
}

function unexpectedRun({ currentRun, workflowState, adapter }) {
  const runId = currentRun?.[adapter.runtime.runIdField];
  if (!runId) return false;
  const status = String(currentRun?.[adapter.runtime.runStatusField] || '').toUpperCase();
  if (adapter.runtime.terminalRunStatuses.includes(status)) return false;
  return !workflowState || String(currentRun?.[adapter.runtime.runPhaseField] || '') !== String(workflowState.phase || '');
}

function collectReferences({ currentRun, currentTasks, adapter }) {
  const fromRun = adapter.runtime.runReferenceFields.map((field) => currentRun?.[field]);
  const fromTasks = Array.isArray(currentTasks?.tasks)
    ? currentTasks.tasks.flatMap((task) => adapter.runtime.taskReferenceFields.flatMap((field) => Array.isArray(task?.[field]) ? task[field] : [task?.[field]]))
    : [];
  return [...new Set([...fromRun, ...fromTasks].filter((value) => typeof value === 'string' && value.trim()))];
}

function inspectWorktrees({ projectRoot, agentWorktrees, activeTaskIds }) {
  const command = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' });
  if (command.status !== 0) return { entries: [], prunable: [], orphan: [], error: command.stderr.trim() };
  const entries = parseWorktreePorcelain(command.stdout);
  const agentRoot = path.resolve(projectRoot, agentWorktrees);
  const orphan = entries.filter((entry) => entry.worktree
    && path.resolve(entry.worktree).startsWith(`${agentRoot}${path.sep}`)
    && !activeTaskIds.includes(path.basename(entry.worktree)));
  return { entries, prunable: entries.filter((entry) => entry.prunable), orphan };
}

function parseWorktreePorcelain(text) {
  const entries = [];
  let entry = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (Object.keys(entry).length) entries.push(entry);
      entry = {};
      continue;
    }
    const [key, ...rest] = line.split(' ');
    entry[key] = rest.join(' ') || true;
  }
  if (Object.keys(entry).length) entries.push(entry);
  return entries;
}

function summarizeRun(value, adapter) {
  if (!value) return null;
  return {
    runId: value[adapter.runtime.runIdField] ?? null,
    status: value[adapter.runtime.runStatusField] ?? null,
    phase: value[adapter.runtime.runPhaseField] ?? null,
  };
}

async function readJsonAt(root, relativePath) {
  if (!relativePath) return null;
  return readJsonFile(path.join(root, relativePath));
}

async function readJsonFile(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
}

async function readTextAt(root, relativePath) {
  if (!relativePath) return '';
  const filePath = path.join(root, relativePath);
  if (!existsSync(filePath)) return '';
  return readFile(filePath, 'utf8');
}
