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
  'docs/migration-ledger.md',
];
const boundaryDocuments = [
  'profiles/README.md',
  'validation/README.md',
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

for (const file of canonicalDocuments) {
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

if (!/current_stage:\s*1\b/.test(roadmap)) errors.push('docs/roadmap.md: current_stage must be 1 during repository/document cleanup');
if (!/(Stage 7[^\n]*BossResume|BossResume[^\n]*Stage 7)/i.test(roadmap)) errors.push('docs/roadmap.md: BossResume validation must be bound to Stage 7');

const bossResumeBoundary = await safeRead('projects/bossresume/README.md');
if (!/not[^\n]*(current|canonical)/i.test(bossResumeBoundary)) {
  errors.push('projects/bossresume/README.md: must explicitly reject current-goal or canonical-source authority');
}

const validationBoundary = await safeRead('validation/README.md');
if (!/(Stage 7[^\n]*BossResume|BossResume[^\n]*Stage 7)/i.test(validationBoundary)) {
  errors.push('validation/README.md: must identify BossResume as the Stage 7 validation target');
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
console.log('- current stage: 1');
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
