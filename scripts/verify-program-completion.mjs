#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const completion = await readJson('docs/program-completion.json');
const status = await readJson('docs/program-status.json');
const stage7 = await readJson('docs/stage7-validation-report.json');
const stage8 = await readJson('docs/stage8-correction-report.json');
const stage9 = await readJson('docs/stage9-validation-report.json');

if (completion?.status !== 'COMPLETED') errors.push('program-completion status must be COMPLETED');
if (status?.programLifecycleStatus !== 'COMPLETED') errors.push('program-status programLifecycleStatus must be COMPLETED');
if (status?.currentStage !== 9) errors.push('final currentStage must remain 9');
if (status?.stages?.length !== 9) errors.push('exactly nine stage records are required');
if (!status?.stages?.every((stage) => stage.stage < 9 ? stage.status === 'COMPLETED' : stage.completionStatus === 'COMPLETED')) {
  errors.push('all stages must carry completed evidence');
}
if (completion?.stages?.length !== 9 || !completion?.stages?.every((stage) => stage.status === 'COMPLETED')) {
  errors.push('program-completion must mark all nine stages COMPLETED');
}
if (stage7?.stageGate?.passed !== true) errors.push('Stage 7 Gate must pass');
if (stage8?.status !== 'COMPLETED') errors.push('Stage 8 correction report must be COMPLETED');
if (stage9?.stageGate?.passed !== true) errors.push('Stage 9 Gate must pass');
if (stage9?.coreContractsChangedDuringValidation !== false) errors.push('Stage 9 must not require Core contract changes');
if ((stage9?.materialDifferencesFromBossResume || []).length < 2) errors.push('Stage 9 project must materially differ from BossResume');

for (const file of [
  'validation/bossresume/results/bossresume-validation-report.json',
  'validation/second-project/itsdangerous/results/itsdangerous-validation-report.json',
  'docs/stage6-validation-report.json',
  'docs/stage7-validation-report.json',
  'docs/stage8-correction-report.json',
  'docs/stage9-validation-report.json',
]) {
  try {
    await access(path.join(root, file));
  } catch {
    errors.push(`missing final evidence: ${file}`);
  }
}

if (errors.length) {
  console.error('[verify:program-completion] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[verify:program-completion] passed');
console.log('- implementation stages: 9/9 completed');
console.log('- real-project validations: BossResume + pallets/itsdangerous');
console.log('- final lifecycle status: COMPLETED');

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: ${error.code === 'ENOENT' ? 'missing' : 'invalid JSON'}`);
    return null;
  }
}
