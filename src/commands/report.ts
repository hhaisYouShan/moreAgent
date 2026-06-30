import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readSessions } from '../session';
import { printJson, printJsonError } from '../output/json';
import { ReportModel, printReportText } from '../output/report';
import { Run, Session } from '../types';

const FULL_WORKFLOW_PHASES = ['brain', 'prd', 'prd-review', 'prd-gate', 'tech-plan', 'tech-gate', 'implementation', 'test', 'review'];

export interface ReportOptions {
  latest?: boolean;
  run?: string;
  json?: boolean;
}

export function reportCommand(options: ReportOptions): void {
  const data = readSessions();
  const runs = [...data.runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (runs.length === 0) {
    if (options.json) {
      printJsonError('NO_RUNS', 'No runs found.');
    }
    console.log('No runs found.');
    return;
  }

  const run = options.run
    ? runs.find((r) => {
        const needle = options.run!;
        return r.id === needle || r.id.startsWith(needle);
      })
    : runs[0];

  if (!run) {
    if (options.json) {
      printJsonError('RUN_NOT_FOUND', `Run not found: ${options.run}`);
    }
    console.log(`Run not found: ${options.run}`);
    return;
  }

  const model = buildReport(run);

  if (options.json) {
    printJson(model);
  } else {
    printReportText(model);
  }
}

function buildReport(run: Run): ReportModel {
  const gates = getGateSummary(run);
  const worktree = getWorktreeInfo(run);
  const canMerge = checkCanMerge(run);
  const canResume = checkCanResume(run);
  const mainStatus = getMainGitStatus();
  const mainClean = mainStatus.length === 0;
  const mainDirtyFiles = mainClean ? [] : mainStatus.split('\n').filter(Boolean);

  return {
    report: {
      run: {
        id: run.id,
        task: run.task,
        status: run.status,
        createdAt: run.createdAt,
        profile: run.workflow?.profile ?? (isFullWorkflowRun(run) ? 'full' : 'mvp'),
      },
      workflow: {
        completedPhases: run.workflow?.completedPhases ?? [],
        failedPhase: run.workflow?.failedPhase ?? null,
        totalPhases: FULL_WORKFLOW_PHASES.length,
        completedCount: (run.workflow?.completedPhases ?? []).length,
      },
      gates: { prdGate: gates.prdGate, techGate: gates.techGate },
      quality: {
        test: gates.test,
        review: gates.review,
        hasRepair: isRepairRun(run),
        repairCount: countRepairSessions(run),
        repairRounds: countRepairRounds(run),
      },
      worktree,
      merge: {
        canMerge: canMerge.ok,
        blockedReason: canMerge.reason,
        mainClean,
        mainDirtyFiles,
      },
      decision: computeDecision(run, gates, canMerge.ok, canResume.ok, worktree, mainClean),
    },
  };
}

function computeDecision(
  run: Run,
  gates: ReturnType<typeof getGateSummary>,
  canMerge: boolean,
  canResume: boolean,
  worktree: ReturnType<typeof getWorktreeInfo>,
  mainClean: boolean,
): ReportModel['report']['decision'] {
  const isFull = run.workflow?.profile === 'full' ||
    run.sessions.some((s) => s.agentName.startsWith('brain'));

  const explicitFailure =
    run.status === 'failed' ||
    gates.test === 'FAIL' ||
    gates.review === 'CHANGES_REQUESTED' ||
    (isFull && gates.prdGate === 'CHANGES_REQUESTED') ||
    (isFull && gates.techGate === 'CHANGES_REQUESTED');

  const anyUnknown =
    gates.test === 'unknown' ||
    gates.review === 'unknown' ||
    (isFull && gates.prdGate === 'unknown') ||
    (isFull && gates.techGate === 'unknown');

  let overallStatus: string;
  if (run.status === 'running') {
    overallStatus = 'RUNNING';
  } else if (explicitFailure) {
    overallStatus = 'FAILED';
  } else if (run.status === 'completed' && anyUnknown) {
    overallStatus = 'PARTIAL';
  } else if (
    run.status === 'completed' &&
    gates.test === 'PASS' &&
    gates.review === 'APPROVED' &&
    (!isFull || gates.prdGate === 'APPROVED') &&
    (!isFull || gates.techGate === 'APPROVED')
  ) {
    overallStatus = 'PASSED';
  } else {
    overallStatus = 'UNKNOWN';
  }

  let recommendation: string;
  if (overallStatus === 'RUNNING') {
    recommendation = 'RUNNING';
  } else if (overallStatus === 'PASSED' && canMerge && worktree.exists && mainClean) {
    recommendation = 'MERGE_READY';
  } else if (overallStatus === 'PASSED' && (!canMerge || !worktree.exists || !mainClean)) {
    recommendation = 'BLOCKED';
  } else if (overallStatus === 'FAILED' && canResume) {
    recommendation = 'NEEDS_REPAIR';
  } else if (overallStatus === 'PARTIAL') {
    recommendation = 'NEEDS_REVIEW';
  } else {
    recommendation = 'UNKNOWN';
  }

  return { canResume, overallStatus, recommendation };
}

// ---- inline helpers (no exports from status.ts) ----

function getGateSummary(run: Run) {
  let prdGate = 'unknown', techGate = 'unknown', test = 'unknown', review = 'unknown';
  for (const s of run.sessions) {
    try {
      for (const f of fs.readdirSync(s.artifactDir)) {
        if (!f.endsWith('.md')) continue;
        const fp = path.join(s.artifactDir, f);
        const content = readFileSafe(fp);
        if (!content) continue;
        if (f.startsWith('prd-decision')) prdGate = parseDecisionLine(content);
        if (f.startsWith('tech-review')) techGate = parseDecisionLine(content);
        if (f.includes('test-report')) test = parseResultLine(content);
        if (f.includes('review-report')) review = parseDecisionLine(content);
      }
    } catch { /* dir may not exist */ }
  }
  return { prdGate, techGate, test, review };
}

function matchLine(content: string, key: string): string | null {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const bare = new RegExp(`^${key}:\\s*(\\S+)`, 'i').exec(t);
    if (bare) return bare[1];
    const bold = new RegExp(`^\\*\\*${key}:\\s*(\\S+)\\*\\*`, 'i').exec(t);
    if (bold) return bold[1];
  }
  return null;
}

function parseDecisionLine(c: string): string {
  const v = matchLine(c, 'Decision');
  if (v === 'APPROVED' || v === 'CHANGES_REQUESTED') return v;
  return 'unknown';
}

function parseResultLine(c: string): string {
  const v = matchLine(c, 'Result');
  if (v === 'PASS' || v === 'FAIL') return v;
  return 'unknown';
}

function readFileSafe(fp: string): string | null {
  try { const c = fs.readFileSync(fp, 'utf-8').trim(); return c.length > 0 ? c : null; } catch { return null; }
}

function isRepairRun(run: Run): boolean {
  for (const s of run.sessions) {
    const n = s.agentName;
    if (n.includes('repair') || n.includes('retry') || n.includes('failure-analysis') || n.includes('revision')) return true;
  }
  return false;
}

function countRepairSessions(run: Run): number {
  return run.sessions.filter((s) => {
    const n = s.agentName;
    return n.includes('repair') || n.includes('retry') || n.includes('failure-analysis') || n.includes('revision');
  }).length;
}

function countRepairRounds(run: Run): number {
  let maxRound = 0;
  for (const s of run.sessions) {
    const n = s.agentName;
    const match = n.match(/^(?:repair|retry|revision)-(\d+)|failure-analysis-\w+-(\d+)$/);
    if (match) {
      const r = parseInt(match[1] || match[2], 10);
      if (r > maxRound) maxRound = r;
    }
  }
  return maxRound > 0 || countRepairSessions(run) > 0 ? Math.max(maxRound, 1) : 0;
}

function checkCanResume(run: Run): { ok: boolean; reason: string } {
  if (!isFullWorkflowRun(run)) return { ok: false, reason: 'not a full workflow run' };
  if (run.status !== 'failed' && run.status !== 'running') return { ok: false, reason: `run is ${run.status}` };
  const completed = run.workflow?.completedPhases ?? [];
  if (completed.length >= FULL_WORKFLOW_PHASES.length) return { ok: false, reason: 'all phases completed' };
  return { ok: true, reason: '' };
}

function checkCanMerge(run: Run): { ok: boolean; reason: string } {
  if (run.status !== 'completed') return { ok: false, reason: `run is ${run.status}` };
  if (run.mergedAt) return { ok: false, reason: 'already merged' };
  const w = run.sessions.find((s) => s.worktreePath);
  if (!w?.worktreePath) return { ok: false, reason: 'no worktree' };
  if (!fs.existsSync(w.worktreePath)) return { ok: false, reason: 'worktree missing' };
  return { ok: true, reason: '' };
}

function getWorktreeInfo(run: Run) {
  const w = run.sessions.find((s) => s.worktreePath);
  if (!w?.worktreePath) return { hasWorktree: false, exists: false, path: '', branch: '', dirty: 'unknown' };
  const exists = fs.existsSync(w.worktreePath);
  let branch = '', dirty = 'unknown';
  if (exists) {
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: w.worktreePath, encoding: 'utf-8' }).trim();
      const st = execSync('git status --porcelain', { cwd: w.worktreePath, encoding: 'utf-8' }).trim();
      dirty = st ? 'yes' : 'no';
    } catch { /* ignore */ }
  }
  return { hasWorktree: true, exists, path: w.worktreePath, branch, dirty };
}

function getMainGitStatus(): string {
  try { return execSync('git status --porcelain', { cwd: process.cwd(), encoding: 'utf-8' }).trim(); } catch { return ''; }
}

function isFullWorkflowRun(run: Run): boolean {
  if (run.workflow?.profile === 'full') return true;
  const names = run.sessions.map((s) => s.agentName);
  return names.some((n) => n.startsWith('brain')) &&
    names.some((n) => n.startsWith('product')) &&
    names.some((n) => n.startsWith('frontend'));
}
