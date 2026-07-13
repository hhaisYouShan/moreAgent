#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const canonicalDocuments = [
  'README.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/roadmap.md',
  'docs/program-status.json',
  'docs/repository-inventory.md',
  'docs/migration-ledger.md',
  'docs/contracts.md',
  'docs/execution-plane.md',
  'docs/evidence-and-operations.md',
];
const boundaryDocuments = [
  'profiles/README.md',
  'validation/README.md',
  'validation/bossresume/README.md',
  'legacy/README.md',
  'projects/bossresume/README.md',
];

const errors = [];
for (const file of canonicalDocuments) {
  if (!(await exists(file))) errors.push(`missing canonical document: ${file}`);
}
for (const file of boundaryDocuments) {
  if (!(await exists(file))) errors.push(`missing repository boundary document: ${file}`);
}

const forbiddenCurrentGoalPatterns = [
  /current\s+unique\s+(business\s+)?goal[^\n]*bossresume/i,
  /当前唯一(?:业务|主)?目标[^\n]*bossresume/i,
  /当前目标[^\n]*完整交付[^\n]*bossresume/i,
];

for (const file of canonicalDocuments.filter((file) => file.endsWith('.md'))) {
  const content = await safeRead(file);
  for (const pattern of forbiddenCurrentGoalPatterns) {
    if (pattern.test(content)) {
      errors.push(`${file}: BossResume must be described as Stage 7 validation, not the current OS delivery goal`);
    }
  }
}

const roadmap = await safeRead('docs/roadmap.md');
for (let stage = 1; stage <= 9; stage += 1) {
  if (!new RegExp(`Stage ${stage}\\b`).test(roadmap)) errors.push(`docs/roadmap.md: missing Stage ${stage}`);
}

const programStatus = await readJson('docs/program-status.json');
const currentStage = Number(programStatus?.currentStage);
if (!Number.isInteger(currentStage) || currentStage < 1 || currentStage > 9) {
  errors.push('docs/program-status.json: currentStage must be an integer from 1 to 9');
}
if (!new RegExp(`current_stage:\\s*${currentStage}\\b`).test(roadmap)) {
  errors.push('docs/roadmap.md: current_stage must match docs/program-status.json');
}

const stages = Array.isArray(programStatus?.stages) ? programStatus.stages : [];
if (stages.length !== 9) errors.push('docs/program-status.json: exactly 9 stages are required');
for (let stage = 1; stage <= 9; stage += 1) {
  const record = stages.find((item) => item?.stage === stage);
  if (!record) {
    errors.push(`docs/program-status.json: missing stage ${stage}`);
    continue;
  }
  const expectedStatus = stage < currentStage ? 'COMPLETED' : stage === currentStage ? 'IN_PROGRESS' : 'NOT_STARTED';
  if (record.status !== expectedStatus) {
    errors.push(`docs/program-status.json: Stage ${stage} must be ${expectedStatus} when currentStage=${currentStage}`);
  }
  if (record.status === 'COMPLETED' && (!Array.isArray(record.evidence) || !record.evidence.length)) {
    errors.push(`docs/program-status.json: completed Stage ${stage} requires evidence`);
  }
}

if (programStatus?.rules?.sequential !== true) errors.push('docs/program-status.json: sequential rule must remain true');
if (programStatus?.rules?.bossResumeMinimumStage !== 7) errors.push('docs/program-status.json: BossResume minimum stage must remain 7');
if (programStatus?.rules?.bossResumeRequiresStage6Completed !== true) errors.push('docs/program-status.json: BossResume must require Stage 6 completion');
if (currentStage >= 3 && programStatus?.latestValidation?.result !== 'SUCCESS') {
  errors.push('docs/program-status.json: advanced stages require a successful validation record');
}

if (!/(Stage 7[^\n]*BossResume|BossResume[^\n]*Stage 7)/i.test(roadmap)) {
  errors.push('docs/roadmap.md: BossResume validation must be bound to Stage 7');
}

const inventory = await safeRead('docs/repository-inventory.md');
for (const requiredPath of ['src/', 'schemas/', 'profiles/', 'adapters/', 'validation/', 'scripts/agent-loop/', 'agent-loop-docs/', 'projects/bossresume/', 'migration-reference/']) {
  if (!inventory.includes(`\`${requiredPath}\``)) errors.push(`docs/repository-inventory.md: missing classification for ${requiredPath}`);
}
for (const classification of ['CANONICAL', 'PROFILE', 'ADAPTER', 'COMPATIBILITY_ACTIVE', 'MIGRATION_REFERENCE', 'VALIDATION_RESERVED', 'HISTORICAL']) {
  if (!inventory.includes(`\`${classification}\``)) errors.push(`docs/repository-inventory.md: missing classification ${classification}`);
}

const bossResumeBoundary = await safeRead('projects/bossresume/README.md');
if (!/not[\s\S]*current AI Software Company OS delivery goal/i.test(bossResumeBoundary)) {
  errors.push('projects/bossresume/README.md: must reject current OS delivery-goal authority');
}
if (!/not[\s\S]*canonical OS product or architecture source/i.test(bossResumeBoundary)) {
  errors.push('projects/bossresume/README.md: must reject canonical product/architecture authority');
}

const validationBoundary = await safeRead('validation/README.md');
if (!/(Stage 7[^\n]*BossResume|BossResume[^\n]*Stage 7)/i.test(validationBoundary)) {
  errors.push('validation/README.md: must identify BossResume as the Stage 7 validation target');
}

const bossResumeValidation = await safeRead('validation/bossresume/README.md');
if (currentStage < 7 && !/inactive until Stage 6 system-level testing is approved/i.test(bossResumeValidation)) {
  errors.push('validation/bossresume/README.md: must remain inactive until Stage 6 approval');
}

if (errors.length) {
  console.error('[verify:docs] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[verify:docs] passed');
console.log(`- canonical documents: ${canonicalDocuments.length}`);
console.log(`- repository boundary documents: ${boundaryDocuments.length}`);
console.log('- roadmap stages: 9');
console.log(`- current stage: ${currentStage}`);
console.log(`- completed stages: ${Math.max(0, currentStage - 1)}`);
console.log('- BossResume role: Stage 7 real-project validation');

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function safeRead(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return '';
  }
}

async function readJson(relativePath) {
  const raw = await safeRead(relativePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    errors.push(`${relativePath}: invalid JSON`);
    return null;
  }
}
