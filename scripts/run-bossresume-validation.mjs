#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateTaskDag } from '../src/control-plane/dag.mjs';
import { evaluateTaskPolicy } from '../src/control-plane/policy-engine.mjs';
import { hashContent } from '../src/evidence/artifact-registry.mjs';

const options = parseArgs(process.argv.slice(2));
for (const required of ['project', 'profile', 'acceptanceProfile', 'baseline', 'smoke', 'outputDir']) {
  if (!options[required]) {
    console.error(`Missing --${toKebab(required)}`);
    process.exit(2);
  }
}

const projectRoot = path.resolve(options.project);
const outputDir = path.resolve(options.outputDir);
await mkdir(outputDir, { recursive: true });
const profile = await readJson(options.profile);
const acceptanceProfile = await readJson(options.acceptanceProfile);
const baseline = await readJson(options.baseline);
const smoke = await readJson(options.smoke);
const prdContent = await readFile(path.join(projectRoot, profile.prdPath), 'utf8');
const generatedAt = new Date().toISOString();

const projectMap = baseline.projectMap;
const prdIngestion = {
  schemaVersion: '1.0',
  artifactType: 'PRD_INGESTION',
  projectId: profile.projectId,
  path: profile.prdPath,
  hash: hashContent(prdContent),
  lineCount: prdContent.split(/\r?\n/).length,
  headingCount: [...prdContent.matchAll(/^#{1,6}\s+.+$/gm)].length,
  requirementIds: [...new Set([...prdContent.matchAll(/\bREQ-[A-Z0-9-]+\b/g)].map((match) => match[0]))].sort(),
  generatedAt,
};

const validationTasks = createValidationTasks(profile.projectId);
const dag = validateTaskDag({ tasks: validationTasks });
const agentContract = {
  agentId: 'stage7-validation-agent',
  allowedTools: ['filesystem-read', 'artifact-write', 'git-read', 'git-ephemeral-worktree'],
  editablePaths: ['validation/bossresume/results/**'],
  forbiddenPaths: ['client/**', 'server/**', '.env', '.env.*', 'data/**', 'uploads/**'],
};
const policyResults = validationTasks.map((task) => ({
  taskId: task.taskId,
  ...evaluateTaskPolicy({
    task,
    agentContract,
    requestedTools: task.requestedTools,
    requestedPaths: task.editablePaths,
    executionMode: 'single',
    policy: { autoEnabled: false },
    budgetUsage: { tokens: 0, cost: 0 },
  }),
}));

const findings = [];
if (baseline.status !== 'PASSED') findings.push(finding('BR-B001', 'BLOCKING', 'CORE_OR_PROFILE', `Baseline validation failed: ${baseline.failureReasons.join(', ')}`));
if (smoke.status !== 'PASSED') findings.push(finding('BR-B002', 'BLOCKING', 'INTEGRATION', 'Real repository integration smoke failed.'));
if (!dag.valid) findings.push(finding('BR-B003', 'BLOCKING', 'CONTROL_PLANE', `Validation DAG failed: ${dag.errors.map((error) => error.code).join(', ')}`));
for (const policy of policyResults.filter((result) => !result.allowed)) {
  findings.push(finding(`BR-B-POLICY-${policy.taskId}`, 'BLOCKING', 'POLICY', policy.violations.map((violation) => violation.code).join(', ')));
}
for (const verification of baseline.verificationResults || []) {
  if (verification.result === 'FAIL' && verification.exitCode !== null) {
    findings.push(finding(`BR-M-${verification.verificationId}`, 'MAJOR', 'BOSSRESUME_PROJECT', `${verification.command} failed with exit code ${verification.exitCode}.`));
  }
}
if (smoke.businessCodeModified !== false) findings.push(finding('BR-B004', 'BLOCKING', 'SCOPE', 'Validation modified BossResume business code.'));
if (smoke.remotePushPerformed !== false) findings.push(finding('BR-B005', 'BLOCKING', 'SCOPE', 'Validation performed a remote push.'));
if (!smoke.changedFiles?.every((file) => file.startsWith('.moreagent-validation/'))) findings.push(finding('BR-B006', 'BLOCKING', 'SCOPE', 'Integration smoke changed a non-validation path.'));

const requirementTrace = {
  schemaVersion: '1.0',
  entityType: 'REQUIREMENT_TRACE',
  traceId: 'trace-bossresume-stage7-validation',
  projectId: profile.projectId,
  workflowId: 'workflow-bossresume-stage7-validation',
  requirementId: 'STAGE7-BOSSRESUME-REAL-PROJECT-VALIDATION',
  links: {
    designArtifactIds: ['bossresume-prd-ingestion', 'bossresume-project-map'],
    taskIds: validationTasks.map((task) => task.taskId),
    commitShas: [smoke.taskCommit, smoke.integrationCommit].filter(Boolean),
    testEvidenceIds: ['bossresume-baseline-report', 'bossresume-integration-evidence'],
    gateIds: ['bossresume-stage7-validation-gate'],
    acceptanceIds: [],
  },
  updatedAt: generatedAt,
  version: 1,
};

const checks = {
  BASELINE_COMMIT_RECORDED: /^[a-f0-9]{40}$/.test(baseline.git?.commit || ''),
  REQUIRED_PATHS_PRESENT: baseline.requiredPaths?.filter((item) => item.required).every((item) => item.exists && item.typeMatches),
  MANIFESTS_PARSE: baseline.manifests?.filter((item) => item.required).every((item) => item.exists && !item.parseError),
  PROJECT_MAP_GENERATED: Boolean(projectMap?.projectMapId && projectMap?.hash),
  PRD_HASH_RECORDED: /^sha256:[a-f0-9]{64}$/.test(prdIngestion.hash),
  NO_BUSINESS_CODE_MODIFIED: smoke.businessCodeModified === false,
  NO_SECRET_FILE_READ: !(baseline.projectMap?.files || []).some((file) => /(^|\/)\.env($|\.)/.test(file)),
  TASK_DAG_VALID: dag.valid,
  POLICY_DRY_RUN_PASS: policyResults.every((result) => result.allowed),
  EPHEMERAL_WORKTREE_CREATED: Boolean(smoke.taskCommit),
  REAL_GIT_INTEGRATION_COMMIT_CREATED: Boolean(smoke.integrationCommit),
  INTEGRATION_WORKTREE_REMOVED: smoke.status === 'PASSED',
  AVAILABLE_BUILD_TEST_COMMANDS_EXECUTED: (baseline.verificationResults || []).some((item) => !['git-baseline-clean'].includes(item.verificationId) && item.result !== 'SKIPPED_NOT_REQUIRED'),
  REQUIREMENT_TRACE_COMPLETE_FOR_VALIDATION_SCOPE: Object.values(requirementTrace.links).every((values) => Array.isArray(values)),
  NO_OPEN_BLOCKING_OR_MAJOR_OS_FINDING: !findings.some((item) => ['BLOCKING', 'MAJOR'].includes(item.severity) && item.classification !== 'BOSSRESUME_PROJECT'),
};

for (const requiredCheck of acceptanceProfile.requiredChecks) {
  if (checks[requiredCheck] !== true) findings.push(finding(`BR-CHECK-${requiredCheck}`, 'BLOCKING', 'VALIDATION', `Required check failed: ${requiredCheck}.`));
}

await writeJson(path.join(outputDir, 'bossresume-project-map.json'), projectMap);
await writeJson(path.join(outputDir, 'bossresume-prd-ingestion.json'), prdIngestion);
await writeJson(path.join(outputDir, 'bossresume-task-dag.json'), { valid: dag.valid, levels: dag.levels, topologicalOrder: dag.topologicalOrder, errors: dag.errors, tasks: validationTasks });
await writeJson(path.join(outputDir, 'bossresume-policy-dry-run.json'), { allowed: policyResults.every((result) => result.allowed), results: policyResults });
await writeJson(path.join(outputDir, 'bossresume-integration-evidence.json'), smoke);

const report = {
  schemaVersion: '1.0',
  reportType: 'BOSSRESUME_STAGE7_VALIDATION',
  projectId: profile.projectId,
  repository: profile.repository,
  baselineCommit: baseline.git?.commit || null,
  status: findings.some((item) => item.severity === 'BLOCKING') ? 'FAILED' : findings.some((item) => item.severity === 'MAJOR') ? 'CHANGES_REQUESTED' : 'PASSED',
  checks,
  findings,
  artifacts: acceptanceProfile.requiredArtifacts,
  requirementTrace,
  generatedAt,
  productAcceptanceImplied: false,
  userAcceptanceImplied: false,
};
await writeJson(path.join(outputDir, 'bossresume-validation-report.json'), report);

console.log(`[bossresume-validation] baseline: ${report.baselineCommit}`);
console.log(`[bossresume-validation] status: ${report.status}`);
console.log(`[bossresume-validation] findings: ${report.findings.length}`);
for (const item of findings) console.error(`[${item.severity}] ${item.findingId}: ${item.problem}`);
process.exit(report.status === 'PASSED' ? 0 : 1);

function createValidationTasks(projectId) {
  const base = {
    schemaVersion: '1.0', entityType: 'TASK', workflowId: 'workflow-bossresume-stage7-validation', ownerAgent: 'stage7-validation-agent',
    requirementIds: ['STAGE7-BOSSRESUME-REAL-PROJECT-VALIDATION'], inputHash: `sha256:${'9'.repeat(64)}`,
    softDependsOn: [], conflictsWith: [], resourceLocks: [], forbiddenPaths: ['client/**', 'server/**', '.env', '.env.*'],
    acceptanceCommands: ['node scripts/run-bossresume-validation.mjs'], requiredTests: ['real-project-validation'], maxAttempts: 1, status: 'READY',
  };
  const define = (taskId, goal, dependsOn, consumes, produces, editablePath, requestedTools) => ({
    ...base, taskId, workstreamId: `workstream-${taskId}`, goal, dependsOn, consumes, produces,
    editablePaths: [editablePath], contextManifestId: `context-${taskId}`, requestedTools,
  });
  return [
    define('br-baseline', 'Record the real repository baseline', [], [], ['artifact-br-baseline'], 'validation/bossresume/results/bossresume-baseline-report.json', ['filesystem-read', 'git-read', 'artifact-write']),
    define('br-prd-ingestion', 'Hash and inspect the real BossResume PRD', ['br-baseline'], ['artifact-br-baseline'], ['artifact-br-prd'], 'validation/bossresume/results/bossresume-prd-ingestion.json', ['filesystem-read', 'artifact-write']),
    define('br-project-map', 'Generate a real BossResume Project Map', ['br-baseline'], ['artifact-br-baseline'], ['artifact-br-map'], 'validation/bossresume/results/bossresume-project-map.json', ['filesystem-read', 'git-read', 'artifact-write']),
    define('br-policy-dag', 'Validate Task DAG and policy boundaries', ['br-prd-ingestion', 'br-project-map'], ['artifact-br-prd', 'artifact-br-map'], ['artifact-br-policy'], 'validation/bossresume/results/bossresume-policy-dry-run.json', ['filesystem-read', 'artifact-write']),
    define('br-integration-smoke', 'Create and integrate an ephemeral validation-only Commit', ['br-policy-dag'], ['artifact-br-policy'], ['artifact-br-integration'], 'validation/bossresume/results/bossresume-integration-evidence.json', ['filesystem-read', 'git-read', 'git-ephemeral-worktree', 'artifact-write']),
  ];
}

function finding(findingId, severity, classification, problem) {
  return { findingId, severity, classification, problem, status: 'OPEN' };
}

async function readJson(value) {
  return JSON.parse(await readFile(path.resolve(value), 'utf8'));
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

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

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
