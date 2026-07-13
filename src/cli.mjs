#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readAdapter, inspectStateSources } from './core/state-sources.mjs';
import { reconcileStateSources } from './core/reconcile.mjs';
import { createExecutionPlan } from './runtime/planner.mjs';

const [command, ...args] = process.argv.slice(2);

if (!((command === 'state' && ['inspect', 'reconcile'].includes(args[0])) || command === 'plan')) {
  console.error('Usage: moreagent state <inspect|reconcile> --project <path> --adapter <path> [--apply] [--prune-worktrees] [--remove-orphan-worktrees]\n       moreagent plan --project <path> --adapter <path> [--mode single|auto]');
  process.exit(64);
}

const options = readOptions(command === 'state' ? args.slice(1) : args);
if (!options.project || !options.adapter) {
  console.error('Both --project and --adapter are required.');
  process.exit(64);
}

try {
  const adapter = await readAdapter(path.resolve(options.adapter));
  const projectRoot = path.resolve(options.project);
  const result = command === 'plan'
    ? await createExecutionPlan({ projectRoot, adapter, workflow: (await inspectStateSources({ projectRoot, adapter })).workflow, mode: options.mode || 'single' })
    : args[0] === 'inspect'
      ? await inspectStateSources({ projectRoot, adapter })
      : await reconcileStateSources({
      projectRoot,
      adapter,
      apply: Boolean(options.apply),
      pruneWorktrees: Boolean(options['prune-worktrees']),
      removeOrphanWorktrees: Boolean(options['remove-orphan-worktrees']),
      });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode ?? (result.allowed === false ? 2 : result.splitDetected ? 2 : 0);
} catch (error) {
  console.error(`[moreagent] ${error.message}`);
  process.exitCode = 1;
}

function readOptions(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith('--')) continue;
    const value = values[index + 1];
    if (!value || value.startsWith('--')) result[key.slice(2)] = true;
    else {
      result[key.slice(2)] = value;
      index += 1;
    }
  }
  return result;
}
