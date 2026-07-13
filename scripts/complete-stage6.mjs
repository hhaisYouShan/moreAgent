#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const validation = {
  provider: 'github-actions',
  workflow: process.env.VALIDATION_WORKFLOW || 'verify',
  runId: Number(process.env.VALIDATION_RUN_ID),
  runUrl: process.env.VALIDATION_RUN_URL || '',
  result: process.env.VALIDATION_RESULT || '',
  headBranch: process.env.VALIDATION_HEAD_BRANCH || '',
  headSha: process.env.VALIDATION_HEAD_SHA || '',
  validatedAt: new Date().toISOString(),
  nodeVersions: ['20.x', '22.x'],
};

assertCondition(validation.result === 'success', 'Stage 6 completion requires a successful validation result.');
assertCondition(validation.headBranch === 'ci/verify-stage6-gate', 'Unexpected validation branch.');
assertCondition(Number.isInteger(validation.runId) && validation.runId > 0, 'Validation run ID is required.');
assertCondition(/^[a-f0-9]{40}$/.test(validation.headSha), 'Validation head SHA must be a full Git commit SHA.');

for (const file of [
  'test/system-e2e.test.mjs',
  'test/system-resilience.test.mjs',
  'src/system/os-runtime.mjs',
  'docs/system-testing.md',
  'validation/bossresume/stage7-entry-checklist.md',
]) {
  await access(path.join(root, file));
}

const statusPath = path.join(root, 'docs/program-status.json');
const programStatus = JSON.parse(await readFile(statusPath, 'utf8'));
assertCondition(programStatus.currentStage === 6, `Expected currentStage=6, found ${programStatus.currentStage}.`);

programStatus.updatedAt = validation.validatedAt;
programStatus.currentStage = 7;
programStatus.latestValidation = validation;
for (const stage of programStatus.stages) {
  if (stage.stage <= 6) stage.status = 'COMPLETED';
  else if (stage.stage === 7) stage.status = 'IN_PROGRESS';
  else stage.status = 'NOT_STARTED';
}
const stage6 = programStatus.stages.find((stage) => stage.stage === 6);
stage6.evidence = unique([
  ...(stage6.evidence || []),
  'src/system/os-runtime.mjs',
  'test/system-e2e.test.mjs',
  'test/system-resilience.test.mjs',
  'docs/system-testing.md',
  `github-actions:${validation.runId}`,
]);
const stage7 = programStatus.stages.find((stage) => stage.stage === 7);
stage7.evidence = unique([...(stage7.evidence || []), 'validation/bossresume/stage7-entry-checklist.md']);
await writeJson(statusPath, programStatus);

const report = {
  schemaVersion: '1.0',
  reportType: 'STAGE_COMPLETION',
  stage: 6,
  status: 'COMPLETED',
  completedAt: validation.validatedAt,
  validation,
  verifiedCapabilities: [
    'full-synthetic-lifecycle-through-maintenance',
    'deterministic-task-dag-and-parallel-scheduling',
    'duplicate-active-execution-rejection',
    'scope-secret-tool-budget-and-auto-guards',
    'event-replay-and-state-corruption-detection',
    'side-effect-aware-recovery',
    'real-git-integration-contract',
    'product-and-user-acceptance-baseline-binding',
    'release-health-check-and-maintenance-routing',
  ],
  nextStage: 7,
  nextAction: 'Prepare and run BossResume real-project validation without modifying Core contracts.',
};
await writeJson(path.join(root, 'docs/stage6-validation-report.json'), report);

await replaceFile('docs/roadmap.md', [
  ['current_stage: 6', 'current_stage: 7'],
  ['| Stage 6 — Complete system-level testing | `IN_PROGRESS` |', '| Stage 6 — Complete system-level testing | `COMPLETED` |'],
  ['| Stage 7 — First real-project validation with BossResume | `NOT_STARTED` |', '| Stage 7 — First real-project validation with BossResume | `IN_PROGRESS` |'],
  ['## Stage 6 — Complete system-level testing\n\n**Status:** `IN_PROGRESS`', '## Stage 6 — Complete system-level testing\n\n**Status:** `COMPLETED`'],
  ['## Stage 7 — First real-project validation with BossResume\n\n**Status:** `NOT_STARTED`', '## Stage 7 — First real-project validation with BossResume\n\n**Status:** `IN_PROGRESS`'],
  [
    'Current implementation:\n\n- `src/system/os-runtime.mjs`\n- Stage 6 end-to-end and failure-injection tests are being added.',
    `Completion evidence:\n\n- \`src/system/os-runtime.mjs\`\n- \`test/system-e2e.test.mjs\`\n- \`test/system-resilience.test.mjs\`\n- \`docs/stage6-validation-report.json\`\n- GitHub Actions run \`${validation.runId}\` on Node 20 and Node 22.`,
  ],
]);

await replaceFile('docs/system-testing.md', [
  ['status: in-progress', 'status: completed'],
  ['bossresume_allowed: false', 'bossresume_allowed: true'],
  ['Until these conditions are evidenced, `validation/bossresume/` remains inactive.', `All conditions were evidenced by GitHub Actions run \`${validation.runId}\`. Stage 7 preparation is now allowed.`],
]);

await replaceFile('validation/bossresume/stage7-entry-checklist.md', [
  ['status: blocked', 'status: approved'],
  ['`PENDING_CURRENT_CI`', '`PASS`'],
  ['`PENDING_REVIEW`', '`PASS`'],
  ['`NOT_STARTED` | Project Profile', '`STAGE_7_ACTION` | Project Profile'],
  ['`NOT_STARTED` | Validation Profile', '`STAGE_7_ACTION` | Validation Profile'],
  ['`NOT_STARTED` | User Decision record', '`APPROVED_BY_PROGRAM_INSTRUCTION` | User Decision record'],
  [
    'The checklist may change to `APPROVED` only after Stage 6 is `COMPLETED`. Approval enables preparation of the BossResume Project Profile and validation run; it does not imply BossResume product acceptance or authorize production release.',
    `Stage 6 was completed by GitHub Actions run \`${validation.runId}\`. This checklist authorizes Stage 7 preparation and validation execution; it does not imply BossResume product acceptance or authorize production release.`,
  ],
]);

console.log(`[stage6] completed with GitHub Actions run ${validation.runId}`);
console.log('[stage6] current stage advanced to 7');

async function replaceFile(relativePath, replacements) {
  const target = path.join(root, relativePath);
  let content = await readFile(target, 'utf8');
  for (const [before, after] of replacements) {
    assertCondition(content.includes(before), `${relativePath}: replacement source not found: ${before.slice(0, 80)}`);
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
