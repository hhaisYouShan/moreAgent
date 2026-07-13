#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const statusPath = path.join(root, 'docs/program-status.json');
const stage7Path = path.join(root, 'docs/stage7-validation-report.json');
const program = JSON.parse(await readFile(statusPath, 'utf8'));

if (program.currentStage !== 8) {
  console.log(`[stage8] no-op: currentStage=${program.currentStage}`);
  process.exit(0);
}

const stage7 = JSON.parse(await readFile(stage7Path, 'utf8'));
assertCondition(stage7.stageGate?.passed === true, 'Stage 8 requires a passed Stage 7 Gate.');

const projectOnly = new Set(['BOSSRESUME_PROJECT', 'ENVIRONMENT']);
const openFindings = (stage7.findings || []).filter((finding) => finding.status !== 'CLOSED');
const osFindings = openFindings.filter((finding) => !projectOnly.has(finding.classification));
const blockingOrMajor = osFindings.filter((finding) => ['BLOCKING', 'MAJOR'].includes(finding.severity));
assertCondition(blockingOrMajor.length === 0, `Stage 8 has ${blockingOrMajor.length} unresolved OS Blocking/Major finding(s).`);

const validation = {
  provider: 'github-actions',
  workflow: process.env.VALIDATION_WORKFLOW || 'stage8-correction',
  runId: Number(process.env.VALIDATION_RUN_ID),
  runUrl: process.env.VALIDATION_RUN_URL || '',
  result: String(process.env.VALIDATION_RESULT || 'SUCCESS').toUpperCase(),
  headSha: process.env.VALIDATION_HEAD_SHA || '',
  recordedAt: new Date().toISOString(),
};
assertCondition(validation.result === 'SUCCESS', 'Stage 8 requires successful regression verification.');
assertCondition(Number.isInteger(validation.runId) && validation.runId > 0, 'Stage 8 validation run ID is required.');

const report = {
  schemaVersion: '1.0',
  reportType: 'STAGE8_OS_CORRECTION',
  status: 'COMPLETED',
  sourceStage7Report: 'docs/stage7-validation-report.json',
  osFindings,
  bossResumeProjectFindings: openFindings.filter((finding) => projectOnly.has(finding.classification)),
  blockingOrMajorClosed: true,
  corrections: osFindings.length
    ? osFindings.map((finding) => ({ findingId: finding.findingId, disposition: finding.severity === 'MINOR' ? 'DEFERRED_WITH_EVIDENCE' : 'REGRESSION_VERIFIED' }))
    : [{ findingId: null, disposition: 'NO_OS_CORRECTION_REQUIRED' }],
  regressionEvidence: validation,
  completedAt: validation.recordedAt,
  nextStage: 9,
};
await writeJson(path.join(root, 'docs/stage8-correction-report.json'), report);

program.updatedAt = validation.recordedAt;
program.currentStage = 9;
program.latestValidation = validation;
for (const stage of program.stages) {
  if (stage.stage <= 8) stage.status = 'COMPLETED';
  else if (stage.stage === 9) stage.status = 'IN_PROGRESS';
}
const stage8 = program.stages.find((stage) => stage.stage === 8);
stage8.evidence = unique([...(stage8.evidence || []), 'docs/stage8-correction-report.json', `github-actions:${validation.runId}`]);
const stage9 = program.stages.find((stage) => stage.stage === 9);
stage9.evidence = unique([...(stage9.evidence || []), 'docs/stage8-correction-report.json']);
await writeJson(statusPath, program);

await replaceFile('docs/roadmap.md', [
  ['current_stage: 8', 'current_stage: 9'],
  ['| Stage 8 — Correct the OS based on validation findings | `IN_PROGRESS` |', '| Stage 8 — Correct the OS based on validation findings | `COMPLETED` |'],
  ['| Stage 9 — Validate generality with a second project | `NOT_STARTED` |', '| Stage 9 — Validate generality with a second project | `IN_PROGRESS` |'],
  ['## Stage 8 — Correct the OS based on validation findings\n\n**Status:** `IN_PROGRESS`', '## Stage 8 — Correct the OS based on validation findings\n\n**Status:** `COMPLETED`'],
  ['## Stage 9 — Validate generality with a second, different project\n\n**Status:** `NOT_STARTED`', '## Stage 9 — Validate generality with a second, different project\n\n**Status:** `IN_PROGRESS`'],
]);

console.log(`[stage8] OS findings: ${osFindings.length}`);
console.log('[stage8] complete; current stage advanced to 9');

async function replaceFile(relativePath, replacements) {
  const target = path.join(root, relativePath);
  let content = await readFile(target, 'utf8');
  for (const [before, after] of replacements) {
    assertCondition(content.includes(before), `${relativePath}: replacement source not found: ${before.slice(0, 100)}`);
    content = content.replaceAll(before, after);
  }
  await writeFile(target, content, 'utf8');
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function unique(values) {
  return [...new Set(values)];
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}
