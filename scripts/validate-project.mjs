#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inspectProject } from '../src/validation/project-inspector.mjs';

const options = parseArgs(process.argv.slice(2));
if (!options.project || !options.profile) {
  console.error('Usage: node scripts/validate-project.mjs --project <path> --profile <json> [--output <json>] [--mode inspect|verify]');
  process.exit(2);
}

const projectRoot = path.resolve(options.project);
const profilePath = path.resolve(options.profile);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
const report = await inspectProject({ projectRoot, profile, mode: options.mode || 'inspect' });

if (options.output) {
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[validate-project] report: ${outputPath}`);
}

console.log(`[validate-project] project: ${report.projectId}`);
console.log(`[validate-project] commit: ${report.git.commit || 'UNRESOLVED'}`);
console.log(`[validate-project] files: ${report.projectMap.metadata.fileCount}`);
console.log(`[validate-project] status: ${report.status}`);
for (const reason of report.failureReasons) console.error(`[validate-project] failure: ${reason}`);
process.exit(report.status === 'PASSED' ? 0 : 1);

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
