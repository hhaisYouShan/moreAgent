import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspectStateSources } from './state-sources.mjs';

export async function reconcileStateSources({ projectRoot, adapter, apply = false, pruneWorktrees = false, removeOrphanWorktrees = false, now = () => new Date().toISOString() }) {
  const before = await inspectStateSources({ projectRoot, adapter });
  if (!before.splitDetected) return { ...before, action: 'NOOP', exitCode: 0 };
  if (!apply) return { ...before, action: 'DRY_RUN', exitCode: 2 };

  const archiveDir = await archivePointers({ projectRoot, adapter, before, now });
  await writeWorkflowState({ projectRoot, adapter, target: adapter.reconcile.blockedWorkflow, archiveDir, now });
  await writeIdlePointers({ projectRoot, adapter, archiveDir, now });
  const reset = await inspectStateSources({ projectRoot, adapter });
  const removals = removeOrphanWorktrees ? removeOrphans({ projectRoot, entries: reset.worktrees.orphan }) : [];
  const prune = pruneWorktrees ? git(projectRoot, ['worktree', 'prune', '--expire', 'now']) : null;
  const afterCleanup = await inspectStateSources({ projectRoot, adapter });
  if (afterCleanup.splitDetected) {
    await writeEvidence({ archiveDir, before, after: afterCleanup, status: 'SPLIT', now });
    return { ...afterCleanup, archiveDir: relative(projectRoot, archiveDir), removals, prune: summarizeCommand(prune), action: 'BLOCKED', exitCode: 3 };
  }

  await writeReadyState({ projectRoot, adapter, archiveDir, now });
  const after = await inspectStateSources({ projectRoot, adapter });
  const status = after.splitDetected ? 'SPLIT' : 'RECONCILED';
  await writeEvidence({ archiveDir, before, after, status, now });
  return { ...after, archiveDir: relative(projectRoot, archiveDir), removals, prune: summarizeCommand(prune), action: status === 'RECONCILED' ? 'RECONCILED' : 'BLOCKED', exitCode: status === 'RECONCILED' ? 0 : 3 };
}

async function archivePointers({ projectRoot, adapter, before, now }) {
  const archiveDir = path.join(projectRoot, adapter.reconcile.archiveRoot, now().replace(/[:.]/g, '-'));
  await mkdir(archiveDir, { recursive: true });
  for (const relativePath of [adapter.paths.currentRun, adapter.paths.currentTasks, adapter.paths.currentEvents]) {
    const source = path.join(projectRoot, relativePath);
    if (existsSync(source)) await copyFile(source, path.join(archiveDir, path.basename(relativePath)));
  }
  await writeEvidence({ archiveDir, before, after: null, status: 'SPLIT', now });
  return archiveDir;
}

async function writeIdlePointers({ projectRoot, adapter, archiveDir, now }) {
  const timestamp = now();
  const run = await readJson(projectRoot, adapter.paths.currentRun) || {};
  const idle = adapter.reconcile.idleRun;
  await writeJson(projectRoot, adapter.paths.currentRun, {
    ...run,
    [adapter.runtime.runIdField]: null,
    ...idle,
    updatedAt: timestamp,
    startedAt: null,
    finishedAt: null,
    runDir: null,
    message: `Runtime pointers preserved at ${relative(projectRoot, archiveDir)}; awaiting the adapter checkpoint.`,
  });
  await writeJson(projectRoot, adapter.paths.currentTasks, { runId: null, updatedAt: timestamp, tasks: [] });
  await writeText(projectRoot, adapter.paths.currentEvents, `${JSON.stringify({ time: timestamp, type: 'run_idle', status: 'IDLE', step: 'IDLE', message: 'Reconciled runtime pointers; no active run.' })}\n`);
}

async function writeReadyState({ projectRoot, adapter, archiveDir, now }) {
  await writeWorkflowState({ projectRoot, adapter, target: adapter.reconcile.readyWorkflow, archiveDir, now });
}

async function writeWorkflowState({ projectRoot, adapter, target, archiveDir, now }) {
  const workflow = await readJson(projectRoot, adapter.paths.workflowJson) || {};
  for (const [canonical, source] of Object.entries(adapter.fields)) workflow[source] = target[canonical] ?? null;
  workflow.updatedAt = now();
  workflow.recentIssuesPath = relative(projectRoot, path.join(archiveDir, 'reconciliation.json'));
  workflow.nextInstruction = adapter.m0?.message || 'Checkpoint approval is required before the next execution.';
  await writeJson(projectRoot, adapter.paths.workflowJson, workflow);

  const context = await readJson(projectRoot, adapter.paths.roundContext) || {};
  for (const [canonical, source] of Object.entries(adapter.roundContextFields || adapter.fields)) context[source] = target[canonical] ?? null;
  await writeJson(projectRoot, adapter.paths.roundContext, context);
  const markdown = await readText(projectRoot, adapter.paths.workflowMarkdown);
  await writeText(projectRoot, adapter.paths.workflowMarkdown, replaceMarkdown(markdown, adapter, target));
}

function replaceMarkdown(content, adapter, target) {
  let output = content;
  for (const [canonical, expression] of Object.entries(adapter.markdownPatterns || {})) {
    const value = target[canonical] == null ? 'null' : String(target[canonical]);
    const pattern = new RegExp(expression, 'm');
    output = output.replace(pattern, (match, captured) => match.replace(captured, value));
  }
  return output;
}

function removeOrphans({ projectRoot, entries }) {
  return entries.map((entry) => ({ path: entry.worktree, ...summarizeCommand(git(projectRoot, ['worktree', 'remove', entry.worktree])) }));
}

async function writeEvidence({ archiveDir, before, after, status, now }) {
  await writeFile(path.join(archiveDir, 'reconciliation.json'), `${JSON.stringify({ schema_version: '1.0', type: 'STATE_SOURCE_RECONCILIATION', status, failure_reason: status === 'RECONCILED' ? null : 'state_source_split', created_at: now(), before, after, effective_checkpoint_approval: false }, null, 2)}\n`, 'utf8');
}

function git(cwd, args) { return spawnSync('git', args, { cwd, encoding: 'utf8' }); }
function summarizeCommand(result) { return result ? { exitCode: result.status ?? 1, stderr: result.stderr.trim() } : null; }
function relative(root, target) { return path.relative(root, target); }
async function readJson(root, relativePath) { try { return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')); } catch { return null; } }
async function readText(root, relativePath) { try { return await readFile(path.join(root, relativePath), 'utf8'); } catch { return ''; } }
async function writeJson(root, relativePath, value) { const target = path.join(root, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function writeText(root, relativePath, value) { const target = path.join(root, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, value, 'utf8'); }
