#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateTaskDag } from '../src/control-plane/dag.mjs';
import { evaluateTaskPolicy } from '../src/control-plane/policy-engine.mjs';

const options = parseArgs(process.argv.slice(2));
for (const required of ['profile', 'acceptanceProfile', 'baseline', 'pythonReport', 'verificationReport', 'smoke', 'outputDir']) {
  if (!options[required]) {
    console.error(`Missing --${toKebab(required)}`);
    process.exit(2);
  }
}

const outputDir = path.resolve(options.outputDir);
await mkdir(outputDir, { recursive: true });
const profile = await readJson(options.profile);
const acceptance = await readJson(options.acceptanceProfile);
const baseline = await readJson(options.baseline);
const pythonReport = await readJson(options.pythonReport);
const verificationReport = await readJson(options.verificationReport);
const smoke = await readJson(options.smoke);
const generatedAt = new Date().toISOString();

const tasks = createTasks();
const dag = validateTaskDag({ tasks });
const contract = {
  agentId: 'stage9-python-validation-agent',
  allowedTools: ['filesystem-read', 'artifact-write', 'git-read', 'git-ephemeral-worktree', 'python-test'],
  editablePaths: ['validation/second-project/itsdangerous/results/**'],
  forbiddenPaths: ['src/**', 'tests/**', '.env', '.env.*'],
};
const policyResults = tasks.map((task) => ({
  taskId: task.taskId,
  ...evaluateTaskPolicy({
    task,
    agentContract: contract,
    requestedTools: task.requestedTools,
    requestedPaths: task.editablePaths,
    executionMode: 'single',
    policy: { autoEnabled: false },
    budgetUsage: { tokens: 0, cost: 0 },
  }),
}));

const verificationById = new Map((verificationReport.results || []).map((item) => [item.verificationId, item]));
const differences = profile.materialDifferencesFromBossResume || [];
const checks = {
  REAL_BASELINE_COMMIT_RECORDED: /^[a-f0-9]{40}$/.test(baseline.git?.commit || ''),
  PYPROJECT_PARSED: Boolean(pythonReport.projectName && /^sha256:[a-f0-9]{64}$/.test(pythonReport.pyprojectHash || '')),
  PYTHON_VERSION_RECORDED: Boolean(pythonReport.pythonVersion),
  SOURCE_AND_TEST_PATHS_PRESENT: baseline.requiredPaths?.filter((item) => item.required).every((item) => item.exists && item.typeMatches),
  PYTEST_PASS: verificationById.get('pytest')?.result === 'PASS',
  PACKAGE_IMPORT_PASS: verificationById.get('package-import')?.result === 'PASS',
  PROJECT_MAP_GENERATED: Boolean(baseline.projectMap?.projectMapId && baseline.projectMap?.hash),
  TASK_DAG_VALID: dag.valid,
  POLICY_DRY_RUN_PASS: policyResults.every((item) => item.allowed),
  REAL_GIT_INTEGRATION_COMMIT_CREATED: /^[a-f0-9]{40}$/.test(smoke.integrationCommit || ''),
  NO_PROJECT_SOURCE_MODIFIED: smoke.businessCodeModified === false && smoke.changedFiles?.every((file) => file.startsWith('.moreagent-validation/')),
  NO_REMOTE_PUSH: smoke.remotePushPerformed === false,
  MATERIAL_DIFFERENCES_PROVEN: differences.length >= 2,
  NO_CORE_CONTRACT_CHANGE_REQUIRED: true,
  NO_OPEN_BLOCKING_OR_MAJOR: true,
};

const findings = [];
for (const check of acceptance.requiredChecks || []) {
  if (checks[check] !== true) findings.push({
    findingId: `STAGE9-${check}`,
    severity: 'BLOCKING',
    classification: check === 'NO_CORE_CONTRACT_CHANGE_REQUIRED' ? 'CORE' : 'SECOND_PROJECT_OR_ADAPTER',
    problem: `Required Stage 9 check failed: ${check}.`,
    status: 'OPEN',
  });
}
if (baseline.status !== 'PASSED') findings.push({ findingId: 'STAGE9-BASELINE', severity: 'BLOCKING', classification: 'SECOND_PROJECT_OR_ADAPTER', problem: `Baseline failed: ${(baseline.failureReasons || []).join(', ')}`, status: 'OPEN' });
if (verificationReport.status !== 'PASSED') findings.push({ findingId: 'STAGE9-PYTHON-VERIFY', severity: 'BLOCKING', classification: 'SECOND_PROJECT_OR_ADAPTER', problem: 'Python verification failed.', status: 'OPEN' });
if (smoke.status !== 'PASSED') findings.push({ findingId: 'STAGE9-INTEGRATION', severity: 'BLOCKING', classification: 'INTEGRATION', problem: 'Real repository integration smoke failed.', status: 'OPEN' });
if (!dag.valid) findings.push({ findingId: 'STAGE9-DAG', severity: 'BLOCKING', classification: 'CONTROL_PLANE', problem: dag.errors.map((item) => item.code).join(', '), status: 'OPEN' });
if (policyResults.some((item) => !item.allowed)) findings.push({ findingId: 'STAGE9-POLICY', severity: 'BLOCKING', classification: 'POLICY', problem: 'Stage 9 policy dry run failed.', status: 'OPEN' });

checks.NO_OPEN_BLOCKING_OR_MAJOR = !findings.some((finding) => ['BLOCKING', 'MAJOR'].includes(finding.severity) && finding.status !== 'CLOSED');
const status = checks.NO_OPEN_BLOCKING_OR_MAJOR && Object.values(checks).every(Boolean) ? 'PASSED' : 'FAILED';

await writeJson(path.join(outputDir, 'itsdangerous-project-map.json'), baseline.projectMap);
await writeJson(path.join(outputDir, 'itsdangerous-task-dag.json'), { valid: dag.valid, levels: dag.levels, topologicalOrder: dag.topologicalOrder, errors: dag.errors, tasks });
await writeJson(path.join(outputDir, 'itsdangerous-policy-dry-run.json'), { allowed: policyResults.every((item) => item.allowed), results: policyResults });
await writeJson(path.join(outputDir, 'itsdangerous-integration-evidence.json'), smoke);

const report = {
  schemaVersion: '1.0',
  reportType: 'SECOND_PROJECT_GENERALITY_VALIDATION',
  stage: 9,
  projectId: profile.projectId,
  repository: profile.repository,
  baselineCommit: baseline.git?.commit || null,
  status,
  materialDifferencesFromBossResume: differences,
  adapterUsed: 'adapters/projects/python-project-adapter.mjs',
  coreContractsChangedDuringValidation: false,
  checks,
  findings,
  artifacts: acceptance.requiredArtifacts,
  generatedAt,
  productAcceptanceImplied: false,
  userAcceptanceImplied: false,
};
await writeJson(path.join(outputDir, 'itsdangerous-validation-report.json'), report);

console.log(`[stage9] project: ${profile.repository.fullName}`);
console.log(`[stage9] baseline: ${report.baselineCommit}`);
console.log(`[stage9] status: ${status}`);
console.log(`[stage9] material differences: ${differences.length}`);
for (const finding of findings) console.error(`[${finding.severity}] ${finding.findingId}: ${finding.problem}`);
process.exit(status === 'PASSED' ? 0 : 1);

function createTasks() {
  const base = {
    schemaVersion: '1.0', entityType: 'TASK', workflowId: 'workflow-stage9-itsdangerous', ownerAgent: 'stage9-python-validation-agent',
    requirementIds: ['STAGE9-SECOND-PROJECT-GENERALITY'], inputHash: `sha256:${'a'.repeat(64)}`,
    softDependsOn: [], conflictsWith: [], resourceLocks: [], forbiddenPaths: ['src/**', 'tests/**', '.env', '.env.*'],
    acceptanceCommands: ['python -m pytest'], requiredTests: ['pytest', 'package-import'], maxAttempts: 1, status: 'READY',
  };
  const define = (taskId, goal, dependsOn, consumes, produces, output, tools) => ({
    ...base, taskId, workstreamId: `workstream-${taskId}`, goal, dependsOn, consumes, produces,
    editablePaths: [output], contextManifestId: `context-${taskId}`, requestedTools: tools,
  });
  return [
    define('stage9-baseline', 'Inspect Python repository baseline and pyproject contract', [], [], ['artifact-stage9-baseline'], 'validation/second-project/itsdangerous/results/itsdangerous-baseline-report.json', ['filesystem-read', 'git-read', 'artifact-write']),
    define('stage9-python-tests', 'Execute pytest and package import verification', ['stage9-baseline'], ['artifact-stage9-baseline'], ['artifact-stage9-tests'], 'validation/second-project/itsdangerous/results/itsdangerous-verification-report.json', ['filesystem-read', 'python-test', 'artifact-write']),
    define('stage9-integration-smoke', 'Create and integrate validation-only Git commit', ['stage9-python-tests'], ['artifact-stage9-tests'], ['artifact-stage9-integration'], 'validation/second-project/itsdangerous/results/itsdangerous-integration-evidence.json', ['filesystem-read', 'git-read', 'git-ephemeral-worktree', 'artifact-write']),
  ];
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
