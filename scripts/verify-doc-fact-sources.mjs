#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'README.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/roadmap.md',
  'docs/migration-ledger.md',
];

const errors = [];
for (const file of required) {
  try {
    await access(path.join(root, file));
  } catch {
    errors.push(`missing canonical document: ${file}`);
  }
}

const canonicalFiles = required.filter((file) => file.endsWith('.md'));
const forbiddenCurrentGoalPatterns = [
  /current\s+unique\s+(business\s+)?goal[^\n]*bossresume/i,
  /当前唯一(?:业务|主)?目标[^\n]*bossresume/i,
  /当前目标[^\n]*完整交付[^\n]*bossresume/i,
];

for (const file of canonicalFiles) {
  let content = '';
  try {
    content = await readFile(path.join(root, file), 'utf8');
  } catch {
    continue;
  }
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

if (errors.length) {
  console.error('[verify:docs] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[verify:docs] passed');
console.log(`- canonical documents: ${required.length}`);
console.log('- roadmap stages: 9');
console.log('- current stage: 1');
console.log('- BossResume role: Stage 7 real-project validation');

async function safeRead(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return '';
  }
}
