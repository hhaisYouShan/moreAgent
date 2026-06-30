import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readSessions } from '../session';
import { Run, Session } from '../types';

export interface StatusOptions {
  latest?: boolean;
  latestRepair?: boolean;
  latestFull?: boolean;
  run?: string;
  summary?: boolean;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_AGENT_ORDER = ['architect', 'implementer', 'tester', 'reviewer'];
const FULL_PHASES = ['brain', 'prd', 'prd-review', 'prd-gate', 'tech-plan', 'tech-gate', 'implementation', 'test', 'review'];

export function statusCommand(options: StatusOptions = {}): void {
  const data = readSessions();
  const runs = [...data.runs].sort(compareRunsByCreatedAtDesc);

  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  if (options.run) {
    const needle = options.run;
    const run = runs.find((r) => r.id === needle || r.id.startsWith(needle));
    if (!run) {
      console.log(`Run not found: ${options.run}`);
      return;
    }
    if (options.summary) {
      printRunSummary(run);
    } else {
      printLatestRun(run);
    }
    return;
  }

  if (options.latestRepair) {
    const repairRun = runs.find(isRepairRun);
    if (!repairRun) {
      console.log('No repair run found.');
      console.log('Repair runs have sessions containing repair/retry/failure-analysis/revision.');
      return;
    }
    if (options.summary) {
      printRunSummary(repairRun);
    } else {
      printLatestRun(repairRun);
    }
    return;
  }

  if (options.latestFull) {
    const fullRun = runs.find(isFullWorkflowRun);
    if (!fullRun) {
      console.log('No full workflow run found.');
      console.log('Create one with:');
      console.log('  moreagent init --profile full');
      console.log('  moreagent start --once --task "your task"');
      return;
    }
    if (options.summary) {
      printRunSummary(fullRun);
    } else {
      printLatestRun(fullRun);
    }
    return;
  }

  if (options.latest) {
    if (options.summary) {
      printRunSummary(runs[0]);
    } else {
      printLatestRun(runs[0]);
    }
    return;
  }

  printRunList(runs.slice(0, DEFAULT_LIMIT));
}

function printRunSummary(run: Run): void {
  const wt = getWorktreeInfo(run);
  const repaired = isRepairRun(run);
  const canResume = checkCanResume(run);
  const canMerge = checkCanMerge(run);
  const gates = getGateSummary(run);

  console.log('Run Summary:');
  console.log(`  Run ID:       ${run.id}`);
  console.log(`  Task:         ${run.task}`);
  console.log(`  Status:       ${run.status}`);
  console.log(`  Created At:   ${run.createdAt}`);
  console.log(`  Profile:      ${getProfile(run)}`);
  console.log(`  Completed:    ${run.status === 'completed' ? 'yes' : 'no'}`);
  console.log(`  Failed:       ${run.status === 'failed' ? 'yes' : 'no'}`);
  console.log(`  Can Resume:   ${canResume.ok ? 'yes' : 'no'}${canResume.ok ? '' : ' (' + canResume.reason + ')'}`);
  console.log(`  Can Merge:    ${canMerge.ok ? 'yes' : 'no'}${canMerge.ok ? '' : ' (' + canMerge.reason + ')'}`);
  console.log(`  Has Worktree: ${wt.hasWorktree ? 'yes' : 'no'}`);
  console.log(`  WT Exists:    ${wt.exists ? 'yes' : 'no'}`);
  if (wt.path) console.log(`  WT Path:      ${wt.path}`);
  if (wt.branch) console.log(`  WT Branch:    ${wt.branch}`);
  console.log(`  Has Repair:   ${repaired ? 'yes' : 'no'}`);

  if (repaired) {
    const rs = getRepairSummary(run);
    console.log(`  Repair Sessions: ${rs.total}`);
    console.log(`    Failure Analysis: ${rs.failureAnalysis}`);
    console.log(`    Repairs:          ${rs.repairs}`);
    console.log(`    Retries:          ${rs.retries}`);
    console.log(`    Revisions:        ${rs.revisions}`);
    if (rs.lastFailed) {
      console.log(`  Last Failed:   ${rs.lastFailed.agentName} (${rs.lastFailed.status})`);
      if (rs.lastFailed.error) console.log(`    Error:        ${rs.lastFailed.error}`);
    }
  }

  console.log(`  Has Gate:     ${gates.hasGate ? 'yes' : 'no'}`);
  if (gates.hasGate) {
    console.log(`  PRD Gate:     ${gates.prdGate}`);
    console.log(`  Tech Gate:    ${gates.techGate}`);
    console.log(`  Test:         ${gates.test}`);
    console.log(`  Review:       ${gates.review}`);
  }

  if (run.workflow?.failedPhase) {
    console.log(`  Failed Phase: ${run.workflow.failedPhase}`);
  }

  const lastFailed = findLastFailed(run);
  if (lastFailed) {
    console.log(`  Final Failed:  ${lastFailed.agentName}`);
    if (lastFailed.error) console.log(`  Error:         ${lastFailed.error}`);
  }

  console.log('');
  console.log('Next Action:');
  const actions = getNextActions(run, canResume, canMerge, repaired);
  for (const a of actions) console.log(`  ${a}`);
}

function printRunList(runs: Run[]): void {
  console.log(`Latest runs (${runs.length}):`);
  for (const run of runs) {
    console.log('');
    console.log(`${run.id}`);
    console.log(`  Task: ${run.task}`);
    console.log(`  Status: ${run.status}`);
    const profile = getProfile(run);
    if (profile !== 'mvp') console.log(`  Profile: ${profile}`);
    if (isRepairRun(run)) console.log(`  Repair: yes`);
    console.log(`  Created At: ${run.createdAt}`);
    console.log(`  Artifacts: ${run.artifactDir}`);
    const wt = getRunWorktreePath(run);
    if (wt) console.log(`  Worktree: ${wt}`);
    console.log(`  Agents: ${formatAgentSummary(run.sessions)}`);
  }
}

function printLatestRun(run: Run): void {
  console.log('Latest run:');
  console.log(`  Run ID: ${run.id}`);
  console.log(`  Task: ${run.task}`);
  console.log(`  Status: ${run.status}`);
  const profile = getProfile(run);
  if (profile !== 'mvp') console.log(`  Profile: ${profile}`);
  if (run.workflow) {
    if (run.workflow.currentPhase) console.log(`  Current Phase: ${run.workflow.currentPhase}`);
    if (run.workflow.completedPhases.length > 0) console.log(`  Completed Phases: ${run.workflow.completedPhases.join(', ')}`);
    if (run.workflow.failedPhase) console.log(`  Failed Phase: ${run.workflow.failedPhase}`);
  }
  console.log(`  Created At: ${run.createdAt}`);
  console.log(`  Artifacts: ${run.artifactDir}`);

  const wt = getWorktreeInfo(run);
  if (wt.path) {
    console.log(`  Worktree: ${wt.path}${wt.exists ? '' : ' (missing)'}`);
  }

  console.log(`  Agents: ${formatAgentSummary(run.sessions)}`);
  if (isRepairRun(run)) console.log(`  Repair: yes`);

  console.log('');
  console.log('Sessions:');
  for (const session of run.sessions) {
    console.log(`  ${session.agentName}`);
    console.log(`    Status: ${session.status}`);
    console.log(`    Duration: ${formatSessionDuration(session)}`);
    console.log(`    Artifacts: ${session.artifactDir}`);
    if (session.worktreePath) console.log(`    Worktree: ${session.worktreePath}`);
    if (session.runtimeSessionId) console.log(`    Runtime Session: ${session.runtimeSessionId}`);
    if (session.error) console.log(`    Error: ${session.error}`);
  }
}

function isRepairRun(run: Run): boolean {
  for (const s of run.sessions) {
    const n = s.agentName;
    if (n.includes('repair') || n.includes('retry') || n.includes('failure-analysis') || n.includes('revision')) return true;
  }
  return false;
}

function isFullWorkflowRun(run: Run): boolean {
  if (run.workflow?.profile === 'full') return true;
  const names = run.sessions.map((s) => s.agentName);
  return names.some((n) => n.startsWith('brain')) &&
    names.some((n) => n.startsWith('product')) &&
    names.some((n) => n.startsWith('frontend'));
}

function getProfile(run: Run): string {
  if (run.workflow?.profile) return run.workflow.profile;
  return isFullWorkflowRun(run) ? 'full' : 'mvp';
}

function getWorktreeInfo(run: Run): { hasWorktree: boolean; exists: boolean; path: string; branch: string; dirty: string } {
  const wt = run.sessions.find((s) => s.worktreePath)?.worktreePath ?? '';
  if (!wt) return { hasWorktree: false, exists: false, path: '', branch: '', dirty: 'unknown' };
  const exists = fs.existsSync(wt);
  let branch = '', dirty = 'unknown';
  if (exists) {
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: wt, encoding: 'utf-8' }).trim();
      const st = execSync('git status --porcelain', { cwd: wt, encoding: 'utf-8' }).trim();
      dirty = st ? 'yes' : 'no';
    } catch { /* ignore */ }
  }
  return { hasWorktree: true, exists, path: wt, branch, dirty };
}

function checkCanResume(run: Run): { ok: boolean; reason: string } {
  if (!isFullWorkflowRun(run)) return { ok: false, reason: 'not a full workflow run' };
  if (run.status !== 'failed' && run.status !== 'running') return { ok: false, reason: `run is ${run.status}` };
  const completed = run.workflow?.completedPhases ?? [];
  if (completed.length >= FULL_PHASES.length) return { ok: false, reason: 'all phases completed' };
  return { ok: true, reason: '' };
}

function checkCanMerge(run: Run): { ok: boolean; reason: string } {
  if (run.status !== 'completed') return { ok: false, reason: `run is ${run.status}` };
  if (run.mergedAt) return { ok: false, reason: 'already merged' };
  const wt = run.sessions.find((s) => s.worktreePath);
  if (!wt?.worktreePath) return { ok: false, reason: 'no worktree' };
  if (!fs.existsSync(wt.worktreePath)) return { ok: false, reason: 'worktree missing' };
  return { ok: true, reason: '' };
}

function getRepairSummary(run: Run) {
  let failureAnalysis = 0, repairs = 0, retries = 0, revisions = 0;
  let lastFailed: Session | null = null;
  for (const s of [...run.sessions].reverse()) {
    const n = s.agentName;
    if (n.includes('failure-analysis')) failureAnalysis++;
    else if (n.includes('repair')) repairs++;
    else if (n.includes('retry')) retries++;
    else if (n.includes('revision')) revisions++;
    if (!lastFailed && s.status === 'failed') lastFailed = s;
  }
  return { failureAnalysis, repairs, retries, revisions, total: failureAnalysis + repairs + retries + revisions, lastFailed };
}

function getGateSummary(run: Run) {
  let prdGate = 'unknown', techGate = 'unknown', test = 'unknown', review = 'unknown';
  let hasGate = false;
  const sessions = [...run.sessions].sort((a, b) =>
    new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
  for (const s of sessions) {
    try {
      for (const f of fs.readdirSync(s.artifactDir)) {
        if (!f.endsWith('.md')) continue;
        const fp = path.join(s.artifactDir, f);
        const content = readFileSafe(fp);
        if (!content) continue;
        if (f.startsWith('prd-decision')) { prdGate = parseDecision(content); hasGate = true; }
        if (f.startsWith('tech-review')) { techGate = parseDecision(content); hasGate = true; }
        if (f.includes('test-report')) { test = parseResult(content); hasGate = true; }
        if (f.includes('review-report')) { review = parseDecision(content); hasGate = true; }
      }
    } catch { /* artifact dir may not exist */ }
  }
  return { prdGate, techGate, test, review, hasGate };
}

function parseDecision(content: string): string {
  if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) return 'CHANGES_REQUESTED';
  if (/^Decision:\s*APPROVED\s*$/im.test(content)) return 'APPROVED';
  return 'unknown';
}

function parseResult(content: string): string {
  if (/^Result:\s*FAIL\s*$/im.test(content)) return 'FAIL';
  if (/^Result:\s*PASS\s*$/im.test(content)) return 'PASS';
  return 'unknown';
}

function findLastFailed(run: Run): Session | null {
  for (const s of [...run.sessions].reverse()) {
    if (s.status === 'failed') return s;
  }
  return null;
}

function readFileSafe(fp: string): string | null {
  try {
    const c = fs.readFileSync(fp, 'utf-8').trim();
    return c.length > 0 ? c : null;
  } catch { return null; }
}

function getNextActions(run: Run, resume: { ok: boolean }, merge: { ok: boolean }, hasRepair: boolean): string[] {
  const actions: string[] = [];
  if (resume.ok) {
    actions.push(`moreagent start --resume --run ${run.id}`);
    return actions;
  }
  if (merge.ok) {
    actions.push(`moreagent merge --run ${run.id}`);
    return actions;
  }
  if (run.status === 'failed' && hasRepair) {
    actions.push(`moreagent inspect --run ${run.id}`);
  }
  if (run.status === 'running') {
    actions.push(`Run still in progress. Check: moreagent status --run ${run.id}`);
  }
  return actions;
}

function compareRunsByCreatedAtDesc(a: Run, b: Run): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function getRunWorktreePath(run: Run): string | undefined {
  return run.sessions.find((s) => s.worktreePath)?.worktreePath;
}

function formatAgentSummary(sessions: Session[]): string {
  return [...sessions].sort(compareSessionsForSummary)
    .map((s) => `${s.agentName} ${formatSummaryStatus(s.status)}`)
    .join(', ');
}

function compareSessionsForSummary(a: Session, b: Session): number {
  return getAgentOrderIndex(a.agentName) - getAgentOrderIndex(b.agentName);
}

function getAgentOrderIndex(agentName: string): number {
  const idx = DEFAULT_AGENT_ORDER.indexOf(agentName);
  return idx === -1 ? DEFAULT_AGENT_ORDER.length : idx;
}

function formatSummaryStatus(status: Session['status']): string {
  switch (status) { case 'completed': return 'OK'; case 'failed': return 'FAIL'; default: return 'PENDING'; }
}

function formatSessionDuration(session: Session): string {
  if (!session.startedAt || !session.completedAt) return 'N/A';
  const s = new Date(session.startedAt).getTime(), e = new Date(session.completedAt).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 'N/A';
  return `${Math.round((e - s) / 1000)}s`;
}
