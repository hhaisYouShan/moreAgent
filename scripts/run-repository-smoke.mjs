#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { runRepositorySmoke } from '../src/validation/repository-smoke.mjs';

const options = parseArgs(process.argv.slice(2));
if (!options.project || !options.projectId || !options.workflowId || !options.prd) {
  console.error('Usage: node scripts/run-repository-smoke.mjs --project <path> --project-id <id> --workflow-id <id> --prd <relative-path> [--output <json>]');
  process.exit(2);
}

const report = await runRepositorySmoke({
  projectRoot: path.resolve(options.project),
  projectId: options.projectId,
  workflowId: options.workflowId,
  prdPath: options.prd,
  outputPath: options.output ? path.resolve(options.output) : null,
});

console.log(`[repository-smoke] project: ${report.projectId}`);
console.log(`[repository-smoke] base: ${report.baseCommit}`);
console.log(`[repository-smoke] task commit: ${report.taskCommit}`);
console.log(`[repository-smoke] integration commit: ${report.integrationCommit}`);
console.log(`[repository-smoke] status: ${report.status}`);

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) continue;
    const [key, inline] = value.slice(2).split('=', 2);
    result[toCamel(key)] = inline ?? args[++index];
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
