#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { readWorkflowState, writeWorkflowState, decideNextState } from './state.mjs';
import { summarizeGate } from './gate.mjs';
import { buildIssuesFromGateSummary, parseIssuesMarkdown } from './issue-router.mjs';
import { appendAuditEvent } from './audit-log.mjs';
import { readCurrentRunState, appendRunEvent } from './run-status.mjs';
import { persistGateDecision, persistIssues } from './persistence.mjs';
import { buildWorkflowRecommendation } from './recommendation.mjs';
import { formatBeijingTimestamp } from './time.mjs';

const repoRoot = process.cwd();
const CURRENT_RUN_FILE = '.agent-runs/current-run.json';

main().catch((error) => {
  console.error('[verify-current] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  console.log('[verify-current] Starting current artifact reverification...\n');

  const state = await readWorkflowState(repoRoot);
  const { run } = await readCurrentRunState(repoRoot);

  if (!run || !run.runDir) {
    console.log('[verify-current] No current run directory found. Nothing to reverify.');
    process.exit(1);
  }

  const runDir = path.join(repoRoot, run.runDir);
  const summaryPath = path.join(runDir, 'summary.json');

  if (!existsSync(summaryPath)) {
    console.log(`[verify-current] No summary.json found in ${run.runDir}. Cannot reverify without previous Gate data.`);
    process.exit(1);
  }

  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  const { tasks = [], statuses = [] } = summary;
  const businessRound = Number(state.round || 0);
  const verificationFile = path.join(runDir, 'verification-attempts.json');

  let verificationData = { attempts: [] };
  if (existsSync(verificationFile)) {
    verificationData = JSON.parse(await readFile(verificationFile, 'utf8'));
  }
  const verificationAttempt = verificationData.attempts.length + 1;
  const gate = state.gate || 'AUTO_GATE';
  const previousIssues = await readPreviousIssues({ repoRoot, state });
  const reverifyDir = path.join(runDir, 'reverify', `attempt-${verificationAttempt}`);
  await mkdir(reverifyDir, { recursive: true });

  console.log(`[verify-current] Source run: ${run.runId}`);
  console.log(`[verify-current] Run directory: ${run.runDir}`);
  console.log(`[verify-current] Business round: ${businessRound}`);
  console.log(`[verify-current] Verification attempt: ${verificationAttempt}`);
  console.log(`[verify-current] Tasks: ${tasks.length}`);
  console.log('');

  const taskEntries = [];
  const worktreeMap = new Map();
  const missingWorktrees = [];

  for (const task of tasks) {
    taskEntries.push(task);
    const worktreePath = path.join(repoRoot, '.agent-worktrees', task.id);
    if (existsSync(worktreePath)) {
      worktreeMap.set(task.id, { worktreePath });
    } else {
      missingWorktrees.push(task.id);
      console.log(`[verify-current] Missing worktree: ${task.id} (${worktreePath})`);
    }
  }

  if (missingWorktrees.length > 0) {
    console.log(`\n[verify-current] ${missingWorktrees.length} worktree(s) missing. Generating SYSTEM issue.`);

    const rawSystemIssues = [{
      issue_id: 'SYSTEM-WORKTREE-MISSING',
      issue_signature: `sig-worktree-missing-${missingWorktrees.sort().join('-')}`,
      category: 'SYSTEM',
      decision_type: 'AUTO_FIXABLE',
      requires_user_decision: false,
      failure_reason: 'worktree_input_missing',
      owner_agent: 'orchestrator',
      source_task: missingWorktrees.join(','),
      source_agent: 'orchestrator',
      target_files: missingWorktrees.map((id) => `.agent-worktrees/${id}`),
      problem: `Worktree artifacts for task(s) ${missingWorktrees.join(', ')} no longer exist. Cannot reverify without the original worktree contents.`,
      expected_fix: 'Restore the original worktree from its manifest-backed inputs or explicitly start a fresh task. Do not treat this as a user business decision.',
      status: 'OPEN',
      severity: 'BLOCKER',
    }];
    const issues = reconcileReverifiedIssues(rawSystemIssues, previousIssues);
    const gateSummary = { status: 'BLOCKED', rows: [] };
    const next = decideNextState({ state, gateSummary, issues, previousIssues });
    const issuesPath = await persistReverifyIssues({
      repoRoot,
      reverifyDir,
      verificationAttempt,
      featureKey: state.featureKey,
      round: businessRound,
      gate,
      issues,
    });

    await writeWorkflowState({
      state,
      nextPhase: next.nextPhase,
      nextRound: businessRound,
      nextFailureCount: next.nextFailureCount,
      nextGate: next.nextGate,
      nextGateStatus: next.nextGateStatus,
      nextAgent: next.nextAgent,
      ownerAgents: next.ownerAgents,
      issuesPath,
      workflowStatus: next.workflowStatus,
      controllerStep: next.controllerStep,
      failureReason: next.failureReason,
      nextInstruction: next.nextInstruction,
      transitionMeta: {
        reason: 'current_artifacts_reverified_worktree_missing',
        issueCount: issues.length,
        humanIssueCount: 0,
        autoIssueCount: 0,
        systemIssueCount: issues.length,
        verification_attempt: verificationAttempt,
      },
    });

    const workflowState = await readWorkflowState(repoRoot);
    await syncCurrentRunSnapshot({
      repoRoot,
      workflowState,
      issues,
      issuesPath,
      verificationAttempt,
    });

    verificationData.attempts.push({
      verification_attempt: verificationAttempt,
      timestamp: formatBeijingTimestamp(),
      source_run_id: run.runId,
      workflow_status: next.workflowStatus,
      controller_step: next.controllerStep,
      failure_reason: next.failureReason,
      system_issues: issues.length,
      human_issues: 0,
      auto_issues: 0,
      agent_restarted: false,
      missing_worktrees: missingWorktrees,
      issues_path: issuesPath,
    });

    await writeFile(verificationFile, `${JSON.stringify(verificationData, null, 2)}\n`, 'utf8');
    await appendAuditEvent({
      repoRoot,
      event: 'current_artifacts_reverified',
      phase: state.phase,
      gate,
      data: {
        source_run_id: run.runId,
        verification_attempt: verificationAttempt,
        agent_restarted: false,
        outcome: next.workflowStatus,
        failure_reason: next.failureReason,
        missing_worktrees: missingWorktrees,
        issues_path: issuesPath,
      },
      message: `current_artifacts_reverified: worktree_missing for ${missingWorktrees.join(', ')}, attempt=${verificationAttempt}`,
    });

    console.log(`\n[verify-current] ${next.workflowStatus}: ${next.failureReason}.`);
    console.log('[verify-current] Run npm run agent -- status for current state.');
    return;
  }

  const rawGateSummary = await summarizeGate({
    tasks: taskEntries,
    worktrees: worktreeMap,
    statuses,
    scopeViolations: new Map(),
    codeIntegration: new Map(),
    state,
    runId: run.runId,
    repoRoot,
  });

  const rawIssues = buildIssuesFromGateSummary(rawGateSummary, { gate });
  const issues = reconcileReverifiedIssues(rawIssues, previousIssues);
  const systemIssues = issues.filter(isSystemIssue);
  const humanIssues = issues.filter((issue) => issue.decision_type === 'HUMAN_DECISION_REQUIRED');
  const autoIssues = issues.filter((issue) => issue.decision_type === 'AUTO_FIXABLE' && !isSystemIssue(issue));

  console.log(`[verify-current] Gate status: ${rawGateSummary.status}`);
  console.log(`[verify-current] SYSTEM issues: ${systemIssues.length}`);
  console.log(`[verify-current] HUMAN issues: ${humanIssues.length}`);
  console.log(`[verify-current] AUTO issues: ${autoIssues.length}`);
  console.log('');

  for (const issue of systemIssues) console.log(`  SYSTEM: ${issue.issue_id} - ${issue.failure_reason || 'unknown'} (${issue.problem})`);
  for (const issue of humanIssues) console.log(`  HUMAN: ${issue.issue_id} - ${issue.problem}`);

  const decisionPath = await persistReverifyDecision({
    repoRoot,
    reverifyDir,
    verificationAttempt,
    featureKey: state.featureKey,
    round: businessRound,
    gate,
    gateSummary: rawGateSummary,
  });
  const issuesPath = await persistReverifyIssues({
    repoRoot,
    reverifyDir,
    verificationAttempt,
    featureKey: state.featureKey,
    round: businessRound,
    gate,
    issues,
  });

  const next = decideNextState({ state, gateSummary: rawGateSummary, issues, previousIssues });
  await writeWorkflowState({
    state,
    nextPhase: next.nextPhase,
    nextRound: businessRound,
    nextFailureCount: next.nextFailureCount,
    nextGate: next.nextGate,
    nextGateStatus: next.nextGateStatus,
    nextAgent: next.nextAgent,
    ownerAgents: next.ownerAgents,
    issuesPath,
    decisionPath,
    workflowStatus: next.workflowStatus,
    controllerStep: next.controllerStep,
    failureReason: next.failureReason,
    nextInstruction: next.nextInstruction,
    transitionMeta: {
      reason: 'current_artifacts_reverified',
      issueCount: issues.length,
      humanIssueCount: humanIssues.length,
      autoIssueCount: autoIssues.length,
      systemIssueCount: systemIssues.length,
      verification_attempt: verificationAttempt,
    },
  });

  const workflowState = await readWorkflowState(repoRoot);
  await syncCurrentRunSnapshot({
    repoRoot,
    workflowState,
    issues,
    decisionPath,
    issuesPath,
    verificationAttempt,
  });

  verificationData.attempts.push({
    verification_attempt: verificationAttempt,
    timestamp: formatBeijingTimestamp(),
    source_run_id: run.runId,
    gate_status: rawGateSummary.status,
    workflow_status: next.workflowStatus,
    controller_step: next.controllerStep,
    failure_reason: next.failureReason,
    system_issues: systemIssues.length,
    human_issues: humanIssues.length,
    auto_issues: autoIssues.length,
    agent_restarted: false,
    decision_path: decisionPath,
    issues_path: issuesPath,
  });
  await writeFile(verificationFile, `${JSON.stringify(verificationData, null, 2)}\n`, 'utf8');

  await appendAuditEvent({
    repoRoot,
    event: 'current_artifacts_reverified',
    phase: state.phase,
    gate,
    data: {
      source_run_id: run.runId,
      verification_attempt: verificationAttempt,
      agent_restarted: false,
      gate_summary_status: rawGateSummary.status,
      system_issue_count: systemIssues.length,
      human_issue_count: humanIssues.length,
      auto_issue_count: autoIssues.length,
      workflow_status: next.workflowStatus,
      failure_reason: next.failureReason,
      next_phase: next.nextPhase,
      decision_path: decisionPath,
      issues_path: issuesPath,
    },
    message: `current_artifacts_reverified: attempt=${verificationAttempt}, phase=${state.phase}->${next.nextPhase}, workflow_status=${next.workflowStatus}, failure_reason=${next.failureReason || 'none'}`,
  });

  await appendRunEvent({
    repoRoot,
    type: 'artifacts_reverified',
    status: next.workflowStatus,
    step: next.controllerStep,
    message: `Artifacts reverified: attempt=${verificationAttempt}, workflow_status=${next.workflowStatus}, phase=${state.phase}->${next.nextPhase}, failure_reason=${next.failureReason || 'none'}`,
    data: {
      source_run_id: run.runId,
      verification_attempt: verificationAttempt,
      system_issues: systemIssues.length,
      human_issues: humanIssues.length,
      auto_issues: autoIssues.length,
      next_phase: next.nextPhase,
      decision_path: decisionPath,
      issues_path: issuesPath,
    },
  });

  console.log('\n[verify-current] Done.');
  console.log(`  Business Round: ${businessRound} (not incremented)`);
  console.log(`  Verification Attempt: ${verificationAttempt}`);
  console.log(`  Phase: ${state.phase} -> ${next.nextPhase}`);
  console.log(`  Workflow Status: ${next.workflowStatus}`);
  console.log(`  Controller Step: ${next.controllerStep}`);
  console.log(`  Failure Reason: ${next.failureReason || 'none'}`);
  console.log(`  Gate Decision: ${decisionPath}`);
  console.log(`  Issues: ${issuesPath}`);
  console.log('\n[verify-current] workflow-state.json/md and current-run snapshot updated without restarting any Agent.');
  console.log('[verify-current] Run: npm run agent -- status to see the updated state.');
}

async function persistReverifyDecision({ repoRoot, reverifyDir, verificationAttempt, featureKey, round, gate, gateSummary }) {
  const stagedPath = await persistGateDecision({
    repoRoot: reverifyDir,
    featureKey,
    round,
    gate,
    gateSummary,
    copiedOutputs: [],
    runDir: reverifyDir,
  });
  return copyAttemptArtifact({ repoRoot, reverifyDir, stagedPath, verificationAttempt });
}

async function persistReverifyIssues({ repoRoot, reverifyDir, verificationAttempt, featureKey, round, gate, issues }) {
  const stagedPath = await persistIssues({ repoRoot: reverifyDir, featureKey, round, gate, issues });
  return copyAttemptArtifact({ repoRoot, reverifyDir, stagedPath, verificationAttempt });
}

async function copyAttemptArtifact({ repoRoot, reverifyDir, stagedPath, verificationAttempt }) {
  const attemptPath = stagedPath.replace(/\.md$/i, `-reverify-${verificationAttempt}.md`);
  const target = path.join(repoRoot, attemptPath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(reverifyDir, stagedPath), target);
  return attemptPath;
}

function reconcileReverifiedIssues(issues, previousIssues = []) {
  const previousByKey = new Map();
  for (const issue of previousIssues) {
    const key = issue.decision_topic || issue.issue_signature;
    if (key) previousByKey.set(key, issue);
  }

  return issues.map((issue) => {
    const key = issue.decision_topic || issue.issue_signature;
    const previous = key ? previousByKey.get(key) : null;
    if (!previous) {
      const repeatCount = Number(issue.repeat_count || 1);
      return { ...issue, repeat_count: repeatCount, repeated: repeatCount > 1 };
    }
    const repeatCount = Number(previous.repeat_count || 1);
    return {
      ...issue,
      issue_id: previous.issue_id || issue.issue_id,
      repeat_count: repeatCount,
      repeated: repeatCount > 1,
      previous_issue_id: previous.previous_issue_id || null,
      first_seen_round: previous.first_seen_round || previous.round || issue.first_seen_round || null,
    };
  });
}

async function syncCurrentRunSnapshot({ repoRoot, workflowState, issues = [], decisionPath = null, issuesPath = null, verificationAttempt = null }) {
  const currentPath = path.join(repoRoot, CURRENT_RUN_FILE);
  let current = {};
  if (existsSync(currentPath)) current = JSON.parse(await readFile(currentPath, 'utf8'));

  const recommendation = buildWorkflowRecommendation({
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    humanIssueIds: issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').map((item) => item.issue_id).filter(Boolean),
    ownerAgents: workflowState.ownerAgents || workflowState.ownerAgent,
    failureReason: workflowState.failureReason,
  });
  const systemIssueCount = issues.filter(isSystemIssue).length;
  const autoFixableCount = issues.filter((item) => item.decision_type === 'AUTO_FIXABLE' && !isSystemIssue(item)).length;
  const humanDecisionCount = issues.filter((item) => item.decision_type === 'HUMAN_DECISION_REQUIRED').length;
  const workflowSnapshot = {
    phase: workflowState.phase,
    gate: workflowState.gate,
    gateStatus: workflowState.gateStatus,
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    failureReason: workflowState.failureReason || null,
    activeAgent: workflowState.activeAgent || workflowState.nextAgent || null,
    ownerAgent: workflowState.ownerAgent || workflowState.ownerAgents || null,
    recommendedAction: recommendation.action || null,
    recommendedCommand: recommendation.command || null,
    recommendationMessage: recommendation.message || null,
    verification_attempt: verificationAttempt ?? null,
  };

  const patch = {
    workflowSnapshot,
    phase: workflowState.phase,
    gate: workflowState.gate,
    gateStatus: workflowState.gateStatus,
    workflowStatus: workflowState.status || workflowState.workflowStatus,
    controllerStep: workflowState.step,
    failureReason: workflowState.failureReason || null,
    systemIssueCount,
    autoFixableCount,
    humanDecisionCount,
    recommendedAction: recommendation.action || null,
    recommendedCommand: recommendation.command || null,
    updatedAt: formatBeijingTimestamp(),
  };
  if (decisionPath !== null) patch.decisionPath = decisionPath;
  if (issuesPath !== null) patch.issuesPath = issuesPath;

  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8');
}

function isSystemIssue(issue) {
  return String(issue?.category || '').trim().toUpperCase() === 'SYSTEM';
}

async function readPreviousIssues({ repoRoot, state }) {
  if (!state.recentIssuesPath) return [];
  try {
    const content = await readFile(path.join(repoRoot, state.recentIssuesPath), 'utf8');
    return parseIssuesMarkdown(content);
  } catch {
    return [];
  }
}
