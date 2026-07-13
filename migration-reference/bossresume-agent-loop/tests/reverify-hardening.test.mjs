import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistIssues } from '../persistence.mjs';
import { parseIssuesMarkdown } from '../issue-router.mjs';
import { syncCurrentRunWorkflowSnapshot, writeRunFinished } from '../run-status.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const verifyScript = path.resolve(testDir, '../verify-current.mjs');

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createState(root, overrides = {}) {
  const state = {
    featureKey: 'demo',
    prdPath: 'docs/prd/demo.md',
    projectType: 'existing_refactor',
    productPrdEditMode: 'review_only',
    status: 'NEEDS_FIX',
    workflowStatus: 'NEEDS_FIX',
    step: 'FIX',
    phase: 'PRD_REVIEW',
    round: 1,
    failureCount: 0,
    retryCount: 0,
    failureReason: 'changes_requested',
    gate: 'PRD_GATE',
    gateStatus: 'CHANGES_REQUESTED',
    activeAgent: 'product_agent',
    nextAgent: 'product_agent',
    ownerAgent: 'product_agent',
    ownerAgents: 'product_agent',
    ...overrides,
  };
  await writeJson(root, 'agent-loop-docs/process/workflow-state.json', state);
  return state;
}

test('missing worktree reverify uses system outcome, preserves round and does not increment repeat_count', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-reverify-missing-'));
  const previousIssuesPath = await persistIssues({
    repoRoot: root,
    featureKey: 'demo',
    round: 1,
    gate: 'PRD_GATE',
    issues: [{
      issue_id: 'SYSTEM-WORKTREE-MISSING',
      issue_signature: 'sig-worktree-missing-missing-task',
      repeat_count: 2,
      repeated: true,
      category: 'SYSTEM',
      decision_type: 'AUTO_FIXABLE',
      requires_user_decision: false,
      failure_reason: 'worktree_input_missing',
      owner_agent: 'orchestrator',
      issue_type: 'worktree_input_missing',
      gate: 'PRD_GATE',
      source_task: 'missing-task',
      source_agent: 'orchestrator',
      target_files: ['.agent-worktrees/missing-task'],
      problem: 'Original missing worktree evidence',
      expected_fix: 'Restore inputs',
      verification: 'Reverify',
      status: 'OPEN',
      severity: 'BLOCKER',
    }],
  });
  const originalIssues = await readFile(path.join(root, previousIssuesPath), 'utf8');
  const originalDecisionPath = 'agent-loop-docs/decisions/demo-prd-gate-round-1.md';
  await mkdir(path.dirname(path.join(root, originalDecisionPath)), { recursive: true });
  await writeFile(path.join(root, originalDecisionPath), 'ORIGINAL DECISION\n', 'utf8');
  await createState(root, { recentIssuesPath: previousIssuesPath, recentDecisionPath: originalDecisionPath });

  const runDir = '.agent-runs/run-1';
  await writeJson(root, '.agent-runs/current-run.json', {
    runId: 'run-1',
    runDir,
    decisionPath: originalDecisionPath,
    issuesPath: previousIssuesPath,
  });
  await writeJson(root, `${runDir}/summary.json`, {
    tasks: [{ id: 'missing-task', agent: 'product_agent', phase: 'PRD_REVIEW', outputFiles: [], gateResultFile: 'gate.json' }],
    statuses: [{ task: 'missing-task', status: 'done', exitCode: 0 }],
  });

  const result = spawnSync(process.execPath, [verifyScript], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const state = JSON.parse(await readFile(path.join(root, 'agent-loop-docs/process/workflow-state.json'), 'utf8'));
  const run = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.equal(state.round, 1);
  assert.equal(state.status, 'BLOCKED_BY_SYSTEM');
  assert.equal(state.step, 'SYSTEM_FIX');
  assert.equal(state.failureReason, 'worktree_input_missing');
  assert.equal(run.decisionPath, originalDecisionPath);
  assert.match(run.issuesPath, /round-1-reverify-1\.md$/);
  assert.equal(run.systemIssueCount, 1);
  assert.equal(run.autoFixableCount, 0);
  assert.equal(await readFile(path.join(root, previousIssuesPath), 'utf8'), originalIssues);
  assert.equal(await readFile(path.join(root, originalDecisionPath), 'utf8'), 'ORIGINAL DECISION\n');

  const reverifiedIssues = parseIssuesMarkdown(await readFile(path.join(root, run.issuesPath), 'utf8'));
  assert.equal(reverifiedIssues[0].repeat_count, 2);
});

test('normal reverify writes attempt-specific decision and issue artifacts without overwriting originals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-reverify-normal-'));
  const originalDecisionPath = 'agent-loop-docs/decisions/demo-prd-gate-round-1.md';
  const originalIssuesPath = 'agent-loop-docs/issues/demo-issues-round-1.md';
  await mkdir(path.dirname(path.join(root, originalDecisionPath)), { recursive: true });
  await mkdir(path.dirname(path.join(root, originalIssuesPath)), { recursive: true });
  await writeFile(path.join(root, originalDecisionPath), 'ORIGINAL DECISION\n', 'utf8');
  await writeFile(path.join(root, originalIssuesPath), '# Original Issues\n', 'utf8');
  await createState(root, { recentDecisionPath: originalDecisionPath, recentIssuesPath: originalIssuesPath });

  const task = {
    id: 'frontend-recheck',
    slug: 'frontend-recheck',
    taskKind: 'PRD_RECHECK',
    agent: 'frontend_agent',
    phase: 'PRD_REVIEW',
    round: 1,
    outputFiles: ['agent-loop-docs/reviews/recheck.md'],
    gateResultFile: 'agent-loop-docs/gate-results/recheck.json',
  };
  const worktree = path.join(root, '.agent-worktrees', task.id);
  await mkdir(path.join(worktree, 'agent-loop-docs/reviews'), { recursive: true });
  await mkdir(path.join(worktree, 'agent-loop-docs/gate-results'), { recursive: true });
  await writeFile(path.join(worktree, task.outputFiles[0]), `# Recheck\n\nReview Basis: agent-loop-docs/process/prd-review-standard.md\n\n复查问题：A\n已关闭问题：A\n仍未关闭问题：无\n新增问题：无\n\n## Self Check\n结论：PASS\n是否允许进入下一阶段：是\n`, 'utf8');
  await writeJson(worktree, task.gateResultFile, {
    task_id: task.id,
    agent: task.agent,
    phase: task.phase,
    conclusion: 'PASS',
    allows_next_stage: true,
    open_issue_count: 0,
    issues: [],
    open_questions: [],
  });

  const runDir = '.agent-runs/run-2';
  await writeJson(root, '.agent-runs/current-run.json', { runId: 'run-2', runDir, decisionPath: originalDecisionPath, issuesPath: originalIssuesPath });
  await writeJson(root, `${runDir}/summary.json`, { tasks: [task], statuses: [{ task: task.id, status: 'done', exitCode: 0 }] });

  const result = spawnSync(process.execPath, [verifyScript], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const run = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.match(run.decisionPath, /round-1-reverify-1\.md$/);
  assert.match(run.issuesPath, /round-1-reverify-1\.md$/);
  assert.equal(await readFile(path.join(root, originalDecisionPath), 'utf8'), 'ORIGINAL DECISION\n');
  assert.equal(await readFile(path.join(root, originalIssuesPath), 'utf8'), '# Original Issues\n');
  await readFile(path.join(root, run.decisionPath), 'utf8');
  await readFile(path.join(root, run.issuesPath), 'utf8');
});

test('run snapshot helpers exclude SYSTEM issues from auto count and preserve omitted paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-run-snapshot-'));
  await mkdir(path.join(root, '.agent-runs'), { recursive: true });
  await writeJson(root, '.agent-runs/current-run.json', { decisionPath: 'old-decision.md', issuesPath: 'old-issues.md' });
  const workflowState = {
    phase: 'PRD_REVIEW', gate: 'PRD_GATE', gateStatus: 'BLOCKED', status: 'BLOCKED_BY_SYSTEM', step: 'SYSTEM_FIX',
    failureReason: 'worktree_input_missing', nextAgent: 'brain_agent', ownerAgents: 'orchestrator',
  };
  const issues = [{ category: 'SYSTEM', decision_type: 'AUTO_FIXABLE', issue_id: 'SYS-1' }];

  await syncCurrentRunWorkflowSnapshot({ repoRoot: root, workflowState, issues, verificationAttempt: 1 });
  let run = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.equal(run.systemIssueCount, 1);
  assert.equal(run.autoFixableCount, 0);
  assert.equal(run.decisionPath, 'old-decision.md');
  assert.equal(run.issuesPath, 'old-issues.md');

  await writeJson(root, 'agent-loop-docs/process/workflow-state.json', workflowState);
  await writeRunFinished({ repoRoot: root, status: 'BLOCKED', gateSummary: { status: 'BLOCKED' }, issues, decisionPath: 'new-decision.md', issuesPath: 'new-issues.md', completionStatusPath: null });
  run = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.equal(run.systemIssueCount, 1);
  assert.equal(run.autoFixableCount, 0);
  assert.equal(run.workflowSnapshot.recommendedCommand, null);
});
