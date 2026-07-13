#!/usr/bin/env node
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactDir = path.resolve(process.env.STAGE9_ARTIFACT_DIR || '');
const rawResult = String(process.env.VALIDATION_RESULT || '').toLowerCase();
const machineResult = rawResult.toUpperCase();
const workflow = {
  provider: 'github-actions',
  workflow: process.env.VALIDATION_WORKFLOW || 'second-project-stage9-validation',
  runId: Number(process.env.VALIDATION_RUN_ID),
  runUrl: process.env.VALIDATION_RUN_URL || '',
  result: machineResult,
  rawResult,
  headBranch: process.env.VALIDATION_HEAD_BRANCH || '',
  headSha: process.env.VALIDATION_HEAD_SHA || '',
  recordedAt: new Date().toISOString(),
};

assertCondition(artifactDir && path.isAbsolute(artifactDir), 'STAGE9_ARTIFACT_DIR must be absolute.');
assertCondition(workflow.headBranch === 'ci/second-project-stage9', `Unexpected Stage 9 branch: ${workflow.headBranch}`);
assertCondition(Number.isInteger(workflow.runId) && workflow.runId > 0, 'Validation run ID is required.');
assertCondition(/^[a-f0-9]{40}$/.test(workflow.headSha), 'Validation head SHA must be a full Git commit SHA.');

const statusPath = path.join(root, 'docs/program-status.json');
const program = JSON.parse(await readFile(statusPath, 'utf8'));
assertCondition(program.currentStage === 9, `Stage 9 recorder requires currentStage=9, found ${program.currentStage}.`);

const destination = path.join(root, 'validation/second-project/itsdangerous/results');
await mkdir(destination, { recursive: true });
const expectedArtifacts = [
  'itsdangerous-baseline-report.json',
  'itsdangerous-python-report.json',
  'itsdangerous-verification-report.json',
  'itsdangerous-project-map.json',
  'itsdangerous-task-dag.json',
  'itsdangerous-policy-dry-run.json',
  'itsdangerous-integration-evidence.json',
  'itsdangerous-repository-smoke.json',
  'itsdangerous-validation-report.json',
];
const copied = [];
for (const file of expectedArtifacts) {
  try {
    await access(path.join(artifactDir, file));
    await cp(path.join(artifactDir, file), path.join(destination, file));
    copied.push(file);
  } catch {
    // Partial evidence remains useful when validation fails.
  }
}

let report;
try {
  report = JSON.parse(await readFile(path.join(destination, 'itsdangerous-validation-report.json'), 'utf8'));
} catch {
  report = {
    schemaVersion: '1.0',
    reportType: 'SECOND_PROJECT_GENERALITY_VALIDATION',
    stage: 9,
    projectId: 'itsdangerous',
    repository: { provider: 'GITHUB', fullName: 'pallets/itsdangerous', ref: 'main' },
    baselineCommit: null,
    status: 'FAILED',
    materialDifferencesFromBossResume: [
      'PYTHON_VS_TYPESCRIPT_JAVASCRIPT',
      'LIBRARY_VS_FULL_STACK_APPLICATION',
      'PYPROJECT_PYTEST_VS_NPM_MULTI_PACKAGE'
    ],
    adapterUsed: 'adapters/projects/python-project-adapter.mjs',
    coreContractsChangedDuringValidation: false,
    checks: {},
    findings: [{
      findingId: 'STAGE9-WORKFLOW',
      severity: 'BLOCKING',
      classification: 'ENVIRONMENT',
      problem: `Validation workflow ended with ${machineResult} before the complete report was produced.`,
      status: 'OPEN'
    }],
    generatedAt: workflow.recordedAt,
    productAcceptanceImplied: false,
    userAcceptanceImplied: false,
  };
  await writeJson(path.join(destination, 'itsdangerous-validation-report.json'), report);
  if (!copied.includes('itsdangerous-validation-report.json')) copied.push('itsdangerous-validation-report.json');
}

const openBlockingOrMajor = (report.findings || []).filter((finding) => ['BLOCKING', 'MAJOR'].includes(finding.severity) && finding.status !== 'CLOSED');
const requiredPresent = expectedArtifacts
  .filter((file) => file !== 'itsdangerous-repository-smoke.json')
  .every((file) => copied.includes(file));
const passed = rawResult === 'success'
  && report.status === 'PASSED'
  && openBlockingOrMajor.length === 0
  && requiredPresent
  && /^[a-f0-9]{40}$/.test(report.baselineCommit || '')
  && (report.materialDifferencesFromBossResume || []).length >= 2
  && report.coreContractsChangedDuringValidation === false
  && report.productAcceptanceImplied === false
  && report.userAcceptanceImplied === false;

const recordedReport = {
  ...report,
  workflow,
  copiedArtifacts: copied.sort(),
  missingArtifacts: expectedArtifacts.filter((file) => !copied.includes(file)),
  stageGate: {
    passed,
    openBlockingOrMajorCount: openBlockingOrMajor.length,
    requiredArtifactsPresent: requiredPresent,
  },
};
await writeJson(path.join(root, 'docs/stage9-validation-report.json'), recordedReport);

program.updatedAt = workflow.recordedAt;
program.latestValidation = workflow;
const stage9 = program.stages.find((stage) => stage.stage === 9);
stage9.evidence = unique([
  ...(stage9.evidence || []),
  ...copied.map((file) => `validation/second-project/itsdangerous/results/${file}`),
  'docs/stage9-validation-report.json',
  `github-actions:${workflow.runId}`,
]);

if (passed) {
  program.programLifecycleStatus = 'COMPLETED';
  program.completedAt = workflow.recordedAt;
  stage9.status = 'IN_PROGRESS';
  stage9.completionStatus = 'COMPLETED';
  stage9.completedAt = workflow.recordedAt;
  program.stages.filter((stage) => stage.stage < 9).forEach((stage) => {
    stage.status = 'COMPLETED';
    stage.completionStatus = 'COMPLETED';
  });
} else {
  program.programLifecycleStatus = 'ACTIVE';
  stage9.status = 'IN_PROGRESS';
  stage9.completionStatus = 'INCOMPLETE';
}
await writeJson(statusPath, program);

if (passed) {
  const completion = {
    schemaVersion: '1.0',
    program: 'ai-software-company-os',
    status: 'COMPLETED',
    completedAt: workflow.recordedAt,
    finalValidation: workflow,
    stages: program.stages.map((stage) => ({
      stage: stage.stage,
      key: stage.key,
      status: 'COMPLETED',
      evidence: stage.evidence || [],
    })),
    realProjectValidations: [
      {
        stage: 7,
        project: 'hhaisYouShan/bossResume',
        report: 'docs/stage7-validation-report.json',
      },
      {
        stage: 9,
        project: 'pallets/itsdangerous',
        report: 'docs/stage9-validation-report.json',
      }
    ],
    finalClaim: 'All nine implementation and validation stages completed with structured evidence.',
  };
  await writeJson(path.join(root, 'docs/program-completion.json'), completion);
  await replaceFile('docs/roadmap.md', [
    ['status: active', 'status: completed'],
    ['| Stage 9 — Validate generality with a second project | `IN_PROGRESS` |', '| Stage 9 — Validate generality with a second project | `COMPLETED` |'],
    ['## Stage 9 — Validate generality with a second, different project\n\n**Status:** `IN_PROGRESS`', '## Stage 9 — Validate generality with a second, different project\n\n**Status:** `COMPLETED`'],
  ]);
}

console.log(`[stage9] workflow result: ${machineResult}`);
console.log(`[stage9] report status: ${report.status}`);
console.log(`[stage9] open Blocking/Major: ${openBlockingOrMajor.length}`);
console.log(`[stage9] program completed: ${passed}`);

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
