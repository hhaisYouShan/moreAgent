#!/usr/bin/env node
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactDir = path.resolve(process.env.STAGE7_ARTIFACT_DIR || '');
const workflow = {
  provider: 'github-actions',
  workflow: process.env.VALIDATION_WORKFLOW || 'bossresume-stage7-validation',
  runId: Number(process.env.VALIDATION_RUN_ID),
  runUrl: process.env.VALIDATION_RUN_URL || '',
  result: process.env.VALIDATION_RESULT || '',
  headBranch: process.env.VALIDATION_HEAD_BRANCH || '',
  headSha: process.env.VALIDATION_HEAD_SHA || '',
  recordedAt: new Date().toISOString(),
};

assertCondition(artifactDir && path.isAbsolute(artifactDir), 'STAGE7_ARTIFACT_DIR must be an absolute path.');
assertCondition(workflow.headBranch === 'ci/bossresume-stage7', `Unexpected Stage 7 branch: ${workflow.headBranch}`);
assertCondition(Number.isInteger(workflow.runId) && workflow.runId > 0, 'Validation run ID is required.');
assertCondition(/^[a-f0-9]{40}$/.test(workflow.headSha), 'Validation head SHA must be a full Git commit SHA.');

const programPath = path.join(root, 'docs/program-status.json');
const program = JSON.parse(await readFile(programPath, 'utf8'));
assertCondition(program.currentStage === 7, `Stage 7 recorder requires currentStage=7, found ${program.currentStage}.`);

const destination = path.join(root, 'validation/bossresume/results');
await mkdir(destination, { recursive: true });
const expectedArtifacts = [
  'bossresume-baseline-report.json',
  'bossresume-project-map.json',
  'bossresume-prd-ingestion.json',
  'bossresume-task-dag.json',
  'bossresume-policy-dry-run.json',
  'bossresume-integration-evidence.json',
  'bossresume-repository-smoke.json',
  'bossresume-validation-report.json',
];
const copied = [];
for (const file of expectedArtifacts) {
  const source = path.join(artifactDir, file);
  try {
    await access(source);
    await cp(source, path.join(destination, file));
    copied.push(file);
  } catch {
    // Partial evidence is retained for failed runs; absence is recorded below.
  }
}

let report;
try {
  report = JSON.parse(await readFile(path.join(destination, 'bossresume-validation-report.json'), 'utf8'));
} catch {
  report = {
    schemaVersion: '1.0',
    reportType: 'BOSSRESUME_STAGE7_VALIDATION',
    projectId: 'bossresume',
    repository: { provider: 'GITHUB', fullName: 'hhaisYouShan/bossResume', ref: 'master' },
    baselineCommit: null,
    status: 'FAILED',
    checks: {},
    findings: [
      {
        findingId: 'BR-B-WORKFLOW',
        severity: 'BLOCKING',
        classification: 'ENVIRONMENT',
        problem: `Validation workflow ended with ${workflow.result} before the complete report was produced.`,
        status: 'OPEN'
      }
    ],
    artifacts: expectedArtifacts,
    generatedAt: workflow.recordedAt,
    productAcceptanceImplied: false,
    userAcceptanceImplied: false,
  };
  await writeJson(path.join(destination, 'bossresume-validation-report.json'), report);
  if (!copied.includes('bossresume-validation-report.json')) copied.push('bossresume-validation-report.json');
}

const blockingOrMajor = (report.findings || []).filter((finding) => ['BLOCKING', 'MAJOR'].includes(finding.severity) && finding.status !== 'CLOSED');
const requiredPresent = expectedArtifacts
  .filter((file) => file !== 'bossresume-repository-smoke.json')
  .every((file) => copied.includes(file));
const passed = workflow.result === 'success'
  && report.status === 'PASSED'
  && blockingOrMajor.length === 0
  && requiredPresent
  && /^[a-f0-9]{40}$/.test(report.baselineCommit || '')
  && report.productAcceptanceImplied === false
  && report.userAcceptanceImplied === false;

const recordedReport = {
  ...report,
  workflow,
  copiedArtifacts: copied.sort(),
  missingArtifacts: expectedArtifacts.filter((file) => !copied.includes(file)),
  stageGate: {
    passed,
    blockingOrMajorCount: blockingOrMajor.length,
    requiredArtifactsPresent: requiredPresent,
  },
};
await writeJson(path.join(root, 'docs/stage7-validation-report.json'), recordedReport);

program.updatedAt = workflow.recordedAt;
program.latestValidation = workflow;
const stage7 = program.stages.find((stage) => stage.stage === 7);
stage7.evidence = unique([
  ...(stage7.evidence || []),
  ...copied.map((file) => `validation/bossresume/results/${file}`),
  'docs/stage7-validation-report.json',
  `github-actions:${workflow.runId}`,
]);
if (passed) {
  program.currentStage = 8;
  for (const stage of program.stages) {
    if (stage.stage <= 7) stage.status = 'COMPLETED';
    else if (stage.stage === 8) stage.status = 'IN_PROGRESS';
    else stage.status = 'NOT_STARTED';
  }
  const stage8 = program.stages.find((stage) => stage.stage === 8);
  stage8.evidence = unique([...(stage8.evidence || []), 'docs/stage7-validation-report.json']);
} else {
  for (const stage of program.stages) {
    if (stage.stage < 7) stage.status = 'COMPLETED';
    else if (stage.stage === 7) stage.status = 'IN_PROGRESS';
    else stage.status = 'NOT_STARTED';
  }
}
await writeJson(programPath, program);

if (passed) {
  await replaceFile('docs/roadmap.md', [
    ['current_stage: 7', 'current_stage: 8'],
    ['| Stage 7 — First real-project validation with BossResume | `IN_PROGRESS` |', '| Stage 7 — First real-project validation with BossResume | `COMPLETED` |'],
    ['| Stage 8 — Correct the OS based on validation findings | `NOT_STARTED` |', '| Stage 8 — Correct the OS based on validation findings | `IN_PROGRESS` |'],
    ['## Stage 7 — First real-project validation with BossResume\n\n**Status:** `IN_PROGRESS`', '## Stage 7 — First real-project validation with BossResume\n\n**Status:** `COMPLETED`'],
    ['## Stage 8 — Correct the OS based on validation findings\n\n**Status:** `NOT_STARTED`', '## Stage 8 — Correct the OS based on validation findings\n\n**Status:** `IN_PROGRESS`'],
  ]);
}

console.log(`[stage7] workflow result: ${workflow.result}`);
console.log(`[stage7] report status: ${report.status}`);
console.log(`[stage7] open Blocking/Major: ${blockingOrMajor.length}`);
console.log(`[stage7] gate passed: ${passed}`);
console.log(`[stage7] current stage: ${program.currentStage}`);

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
