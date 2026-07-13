import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decideNextState } from '../state.mjs';
import { summarizeGate } from '../gate.mjs';
import { writeRunFinished } from '../run-status.mjs';

test('state runtime routes SYSTEM category through Outcome Classifier', () => {
  const next = decideNextState({
    state: {
      phase: 'PRD_REVIEW',
      round: 2,
      failureCount: 0,
      gate: 'PRD_GATE',
      gateStatus: 'CHANGES_REQUESTED',
      projectType: 'existing_refactor',
    },
    gateSummary: { status: 'CHANGES_REQUESTED', rows: [] },
    issues: [{
      issue_id: 'SYS-1',
      category: 'SYSTEM',
      decision_type: 'AUTO_FIXABLE',
      owner_agent: 'gate_verifier',
      failure_reason: 'worktree_input_missing',
      status: 'OPEN',
    }],
    previousIssues: [],
  });

  assert.equal(next.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(next.controllerStep, 'SYSTEM_FIX');
  assert.equal(next.nextGateStatus, 'BLOCKED');
  assert.match(next.nextInstruction, /不要执行 next 或 decide/);
});

test('gate runtime uses tolerant parser and task-aware PRD_RECHECK policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-gate-'));
  const worktree = path.join(root, 'worktree');
  await mkdir(path.join(worktree, 'agent-loop-docs/reviews'), { recursive: true });
  await mkdir(path.join(worktree, 'agent-loop-docs/gate-results'), { recursive: true });

  const outputFile = 'agent-loop-docs/reviews/recheck.md';
  const gateFile = 'agent-loop-docs/gate-results/recheck.json';
  await writeFile(path.join(worktree, outputFile), `# Recheck

Review Basis: agent-loop-docs/process/prd-review-standard.md

复查问题：A
已关闭问题：A
仍未关闭问题：无
新增问题：无

## Self Check
- **结论**：**PASS**
- **是否允许进入下一阶段**：**是**
`, 'utf8');
  await writeFile(path.join(worktree, gateFile), JSON.stringify({
    task_id: 'frontend-recheck',
    agent: 'frontend_agent',
    phase: 'PRD_REVIEW',
    conclusion: 'PASS',
    allows_next_stage: true,
    open_issue_count: 0,
    issues: [],
    open_questions: [],
  }, null, 2), 'utf8');

  const task = {
    id: 'frontend-recheck',
    slug: 'frontend-recheck',
    taskKind: 'PRD_RECHECK',
    agent: 'frontend_agent',
    phase: 'PRD_REVIEW',
    round: 3,
    outputFiles: [outputFile],
    gateResultFile: gateFile,
  };
  const summary = await summarizeGate({
    tasks: [task],
    worktrees: new Map([[task.id, { worktreePath: worktree }]]),
    statuses: [{ task: task.id, status: 'done', exitCode: 0 }],
    state: { gate: 'PRD_GATE' },
    repoRoot: root,
  });

  assert.equal(summary.status, 'APPROVED');
  assert.equal(summary.rows[0].outputChecks[0].selfCheckConclusion, 'PASS');
  assert.equal(summary.rows[0].outputChecks[0].allowsNextStage, true);
  assert.deepEqual(summary.rows[0].phaseRequirementsMissing, []);
});

test('gate runtime rejects PASS with OPEN issue as OUTPUT_CONTRACT', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-contract-'));
  const worktree = path.join(root, 'worktree');
  await mkdir(path.join(worktree, 'agent-loop-docs/reviews'), { recursive: true });
  await mkdir(path.join(worktree, 'agent-loop-docs/gate-results'), { recursive: true });

  const outputFile = 'agent-loop-docs/reviews/ui.md';
  const gateFile = 'agent-loop-docs/gate-results/ui.json';
  await writeFile(path.join(worktree, outputFile), `# UI Review

评审结论：存在问题
信息架构：已检查
交互状态：已检查
是否阻塞：是

## Self Check
结论：PASS
是否允许进入下一阶段：是
`, 'utf8');
  await writeFile(path.join(worktree, gateFile), JSON.stringify({
    conclusion: 'PASS',
    allows_next_stage: true,
    issues: [{
      severity: 'MAJOR',
      status: 'OPEN',
      decision_type: 'AUTO_FIXABLE',
      owner_agent: 'ui_agent',
      issue_type: 'ui_contract_test',
      problem: 'Open issue',
    }],
  }, null, 2), 'utf8');

  const task = {
    id: 'ui-review',
    slug: 'ui-review',
    taskKind: 'UI_REVIEW',
    agent: 'ui_agent',
    phase: 'PRD_REVIEW',
    round: 3,
    outputFiles: [outputFile],
    gateResultFile: gateFile,
  };
  const summary = await summarizeGate({
    tasks: [task],
    worktrees: new Map([[task.id, { worktreePath: worktree }]]),
    statuses: [{ task: task.id, status: 'done', exitCode: 0 }],
    state: { gate: 'PRD_GATE' },
    repoRoot: root,
  });

  const issue = summary.rows[0].gateResultIssues.find((item) => item.kind === 'gate_result_pass_with_open_issues');
  assert.ok(issue);
  assert.equal(issue.category, 'OUTPUT_CONTRACT');
  assert.equal(issue.decision_type, 'AUTO_FIXABLE');
});

test('writeRunFinished synchronizes workflowSnapshot and recommendation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-run-'));
  await mkdir(path.join(root, 'agent-loop-docs/process'), { recursive: true });
  await mkdir(path.join(root, '.agent-runs'), { recursive: true });

  await writeFile(path.join(root, 'agent-loop-docs/process/workflow-state.json'), JSON.stringify({
    featureKey: 'demo',
    prdPath: 'docs/prd/demo.md',
    projectType: 'existing_refactor',
    status: 'BLOCKED_BY_SYSTEM',
    workflowStatus: 'BLOCKED_BY_SYSTEM',
    step: 'SYSTEM_FIX',
    phase: 'PRD_REVIEW',
    round: 3,
    failureCount: 1,
    retryCount: 1,
    failureReason: 'verifier_inconsistent',
    gate: 'PRD_GATE',
    gateStatus: 'BLOCKED',
    activeAgent: 'brain_agent',
    nextAgent: 'brain_agent',
    ownerAgent: 'gate_verifier',
    ownerAgents: 'gate_verifier',
  }, null, 2), 'utf8');
  await writeFile(path.join(root, 'agent-loop-docs/process/workflow-state.md'), '# state\n', 'utf8');
  await writeFile(path.join(root, '.agent-runs/current-run.json'), JSON.stringify({
    runId: 'run-1',
    status: 'BLOCKED',
    gateStatus: 'RECHECK_REQUIRED',
    message: '继续 /next 即可',
  }, null, 2), 'utf8');

  await writeRunFinished({
    repoRoot: root,
    status: 'BLOCKED',
    gateSummary: { status: 'CHANGES_REQUESTED' },
    issues: [],
    decisionPath: 'decision.md',
    issuesPath: 'issues.md',
    completionStatusPath: 'completion.md',
  });

  const run = JSON.parse(await readFile(path.join(root, '.agent-runs/current-run.json'), 'utf8'));
  assert.equal(run.executionStatus, 'FINISHED');
  assert.equal(run.workflowSnapshot.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(run.workflowSnapshot.controllerStep, 'SYSTEM_FIX');
  assert.equal(run.workflowSnapshot.recommendedCommand, null);
  assert.equal(run.gateStatus, 'BLOCKED');
  assert.doesNotMatch(run.message, /继续\s*\/?next/);
});
