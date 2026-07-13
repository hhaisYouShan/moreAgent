#!/usr/bin/env node
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactDir = path.resolve(process.env.STAGE7_ARTIFACT_DIR || '');
const rawResult = String(process.env.VALIDATION_RESULT || '').toLowerCase();
const machineResult = rawResult.toUpperCase();
const rawWorkflow = {
  provider: 'github-actions',
  workflow: process.env.VALIDATION_WORKFLOW || 'bossresume-stage7-validation',
  runId: Number(process.env.VALIDATION_RUN_ID),
  runUrl: process.env.VALIDATION_RUN_URL || '',
  rawResult,
  headBranch: process.env.VALIDATION_HEAD_BRANCH || '',
  headSha: process.env.VALIDATION_HEAD_SHA || '',
  recordedAt: new Date().toISOString(),
};

assertCondition(artifactDir && path.isAbsolute(artifactDir), 'STAGE7_ARTIFACT_DIR must be absolute.');
assertCondition(rawWorkflow.headBranch === 'ci/bossresume-stage7-v3', `Unexpected Stage 7 branch: ${rawWorkflow.headBranch}`);
assertCondition(Number.isInteger(rawWorkflow.runId) && rawWorkflow.runId > 0, 'Validation run ID is required.');
assertCondition(/^[a-f0-9]{40}$/.test(rawWorkflow.headSha), 'Validation head SHA must be a full Git commit SHA.');

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
  try {
    await access(path.join(artifactDir, file));
    await cp(path.join(artifactDir, file), path.join(destination, file));
    copied.push(file);
  } catch {
    // Partial evidence is kept for diagnosis.
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
    findings: [{
      findingId: 'BR-B-WORKFLOW',
      severity: 'BLOCKING',
      classification: 'ENVIRONMENT',
      problem: `Validation workflow ended with ${machineResult} before complete evidence was produced.`,
      status: 'OPEN'
    }],
    generatedAt: rawWorkflow.recordedAt,
    productAcceptanceImplied: false,
    userAcceptanceImplied: false,
  };
  await writeJson(path.join(destination, 'bossresume-validation-report.json'), report);
  if (!copied.includes('bossresume-validation-report.json')) copied.push('bossresume-validation-report.json');
}

const openFindings = (report.findings || []).filter((finding) => finding.status !== 'CLOSED');
const bossResumeFindings = openFindings.filter((finding) => finding.classification === 'BOSSRESUME_PROJECT');
const osFindings = openFindings.filter((finding) => finding.classification !== 'BOSSRESUME_PROJECT');
const osBlockingOrMajor = osFindings.filter((finding) => ['BLOCKING', 'MAJOR'].includes(finding.severity));
const requiredArtifacts = expectedArtifacts.filter((file) => file !== 'bossresume-repository-smoke.json');
const requiredPresent = requiredArtifacts.every((file) => copied.includes(file));
const completeReport = ['PASSED', 'CHANGES_REQUESTED'].includes(report.status);
const workflowCompatible = rawResult === 'success' || (rawResult === 'failure' && report.status === 'CHANGES_REQUESTED');
const coreChecksPass = [
  'BASELINE_COMMIT_RECORDED',
  'REQUIRED_PATHS_PRESENT',
  'MANIFESTS_PARSE',
  'PROJECT_MAP_GENERATED',
  'PRD_HASH_RECORDED',
  'NO_BUSINESS_CODE_MODIFIED',
  'NO_SECRET_FILE_READ',
  'TASK_DAG_VALID',
  'POLICY_DRY_RUN_PASS',
  'EPHEMERAL_WORKTREE_CREATED',
  'REAL_GIT_INTEGRATION_COMMIT_CREATED',
  'INTEGRATION_WORKTREE_REMOVED',
  'REQUIREMENT_TRACE_COMPLETE_FOR_VALIDATION_SCOPE',
  'NO_OPEN_BLOCKING_OR_MAJOR_OS_FINDING',
].every((check) => report.checks?.[check] === true);
const passed = workflowCompatible
  && completeReport
  && osBlockingOrMajor.length === 0
  && coreChecksPass
  && requiredPresent
  && /^[a-f0-9]{40}$/.test(report.baselineCommit || '')
  && report.productAcceptanceImplied === false
  && report.userAcceptanceImplied === false;

const workflow = {
  ...rawWorkflow,
  result: passed ? 'SUCCESS' : machineResult,
};
const recordedReport = {
  ...report,
  workflow,
  copiedArtifacts: copied.sort(),
  missingArtifacts: expectedArtifacts.filter((file) => !copied.includes(file)),
  osFindings,
  bossResumeProjectFindings: bossResumeFindings,
  stageGate: {
    passed,
    osBlockingOrMajorCount: osBlockingOrMajor.length,
    bossResumeProjectFindingCount: bossResumeFindings.length,
    requiredArtifactsPresent: requiredPresent,
    coreChecksPass,
    validationScope: 'OS_COMPATIBILITY_NOT_BUSINESS_DELIVERY',
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

console.log(`[stage7] raw workflow result: ${machineResult}`);
console.log(`[stage7] report status: ${report.status}`);
console.log(`[stage7] OS Blocking/Major: ${osBlockingOrMajor.length}`);
console.log(`[stage7] BossResume project findings: ${bossResumeFindings.length}`);
console.log(`[stage7] OS validation passed: ${passed}`);

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
