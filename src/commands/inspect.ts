import * as fs from 'fs';
import * as path from 'path';
import { readSessions } from '../session';
import { Run, Session } from '../types';

export interface InspectOptions {
  run?: string;
  agent?: string;
  workflow?: boolean;
}

export function inspectCommand(options: InspectOptions = {}): void {
  const run = findRun(options.run);
  if (!run) {
    console.log('No runs found.');
    return;
  }

  if (options.workflow) {
    printWorkflowInfo(run);
    return;
  }

  if (options.agent) {
    printAgentArtifact(run, options.agent);
    return;
  }

  printRunOverview(run);
}

function findRun(runId?: string): Run | null {
  const data = readSessions();
  const runs = [...data.runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (runs.length === 0) {
    return null;
  }

  if (runId) {
    return runs.find((r) => r.id === runId || r.id.startsWith(runId)) || null;
  }

  return runs[0];
}

function printRunOverview(run: Run): void {
  console.log(`Run: ${run.id}`);
  console.log(`Task: ${run.task}`);
  console.log(`Status: ${run.status}`);
  console.log(`Created: ${run.createdAt}`);
  console.log(`Artifacts: ${run.artifactDir}`);

  const worktreePath = getWorktreePath(run);
  if (worktreePath) {
    console.log(`Worktree: ${worktreePath}`);
  }

  console.log('');
  console.log('Sessions:');
  for (const session of run.sessions) {
    const primaryName = resolvePrimaryArtifact(session.agentName);
    const primaryPath = primaryName
      ? path.join(session.artifactDir, primaryName)
      : session.artifactDir;

    const duration =
      session.startedAt && session.completedAt
        ? `${Math.round(
            (new Date(session.completedAt).getTime() -
              new Date(session.startedAt).getTime()) /
              1000
          )}s`
        : 'N/A';

    console.log(`  ${session.agentName} (${session.status}) [${duration}]`);
    if (primaryName) {
      console.log(`    Primary: ${primaryPath}`);
    }
    if (session.error) {
      console.log(`    Error: ${session.error}`);
    }
  }
}

function printAgentArtifact(run: Run, agentName: string): void {
  const session = findRelevantSession(run, agentName);
  if (!session) {
    console.log(`No session found for agent "${agentName}" in run ${run.id}.`);
    return;
  }

  console.log(`Matched latest session: ${session.agentName}`);
  const primaryName = resolvePrimaryArtifact(session.agentName);

  if (!primaryName) {
    console.log(`No primary artifact defined for session "${session.agentName}".`);
    console.log(`Session artifacts: ${session.artifactDir}`);
    return;
  }

  const filePath = path.join(session.artifactDir, primaryName);
  if (!fs.existsSync(filePath)) {
    console.log(`Artifact not found: ${filePath}`);
    console.log(`The agent may not have written it yet.`);
    return;
  }

  console.log(`Run: ${run.id}`);
  console.log(`Agent: ${session.agentName}`);
  console.log(`Status: ${session.status}`);
  console.log('');
  console.log(`--- ${primaryName} ---`);
  console.log(fs.readFileSync(filePath, 'utf-8'));
}

function findRelevantSession(run: Run, agentName: string): Session | null {
  const sessions = [...run.sessions].reverse();

  for (const session of sessions) {
    const name = session.agentName;

    if (name === agentName) {
      return session;
    }

    if (name.startsWith('repair-') && name.endsWith(`-${agentName}`)) {
      return session;
    }

    const baseRole = name.replace(/^repair-\d+-/, '');
    if (baseRole === agentName) {
      return session;
    }
  }

  return null;
}

const PRIMARY_ARTIFACT_MAP: Record<string, string> = {
  architect: 'brain-plan.md',
  implementer: 'implementation-result.md',
  tester: 'test-report.md',
  reviewer: 'review-report.md',
  brain: 'brain-plan.md',
  product: 'prd.md',
  frontend: 'frontend-plan.md',
  backend: 'backend-plan.md',
};

function resolveArtifactForSessionName(sessionName: string): string | null {
  const map: Record<string, string> = {
    'brain': 'brain-plan.md',
    'product': 'prd.md',
    'frontend-prd-review': 'frontend-prd-review.md',
    'backend-prd-review': 'backend-prd-review.md',
    'test-prd-review': 'test-prd-review.md',
    'prd-gate': 'prd-decision.md',
    'frontend-plan': 'frontend-plan.md',
    'backend-plan': 'backend-plan.md',
    'test-plan': 'test-plan.md',
    'tech-gate': 'tech-review.md',
    'frontend-implementation': 'frontend-implementation.md',
    'backend-implementation': 'backend-implementation.md',
    'tester': 'test-report.md',
    'reviewer': 'review-report.md',
  };

  for (const [key, artifact] of Object.entries(map)) {
    if (sessionName.startsWith(key)) return artifact;
  }

  const base = sessionName.replace(/^repair-\d+-/, '');
  return PRIMARY_ARTIFACT_MAP[base] ?? null;
}

function resolvePrimaryArtifact(sessionName: string): string | null {
  const fromMap = resolveArtifactForSessionName(sessionName);
  if (fromMap) return fromMap;
  const base = sessionName.replace(/^repair-\d+-/, '');
  return PRIMARY_ARTIFACT_MAP[base] ?? null;
}

function getWorktreePath(run: Run): string | undefined {
  for (const session of run.sessions) {
    if (session.worktreePath && fs.existsSync(session.worktreePath)) {
      return session.worktreePath;
    }
  }
  return run.sessions.find((s) => s.worktreePath)?.worktreePath;
}

function printWorkflowInfo(run: Run): void {
  if (!run.workflow && !run.sessions.some((s) => s.agentName.startsWith('brain') || s.agentName.startsWith('product'))) {
    console.log('This run is not a full workflow run.');
    return;
  }

  console.log(`Run: ${run.id}`);
  console.log(`Task: ${run.task}`);
  console.log(`Status: ${run.status}`);

  const wf = run.workflow;
  if (wf) {
    console.log(`  Profile: ${wf.profile}`);
    console.log(`  Current Phase: ${wf.currentPhase || 'N/A'}`);
    console.log(`  Completed Phases: ${wf.completedPhases.join(', ') || '(none)'}`);
    console.log(`  Failed Phase: ${wf.failedPhase || 'N/A'}`);
  }

  console.log('');
  console.log('Gates:');
  const sessions = [...run.sessions];
  for (const s of sessions) {
    const dir = s.artifactDir;
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const fp = path.join(dir, f);
      const c = readFileSafe(fp);
      if (!c) continue;
      if (f.startsWith('prd-decision')) console.log(`  PRD Gate (${f}): ${parseDecisionLine(c)}`);
      if (f.startsWith('tech-review')) console.log(`  Tech Gate (${f}): ${parseDecisionLine(c)}`);
      if (f.includes('test-report')) console.log(`  Test (${f}): ${parseResultLine(c)}`);
      if (f.includes('review-report')) console.log(`  Review (${f}): ${parseDecisionLine(c)}`);
    }
  }

  const repairSessions = sessions.filter((s) => {
    const n = s.agentName;
    return n.includes('repair') || n.includes('retry') || n.includes('failure-analysis') || n.includes('revision');
  });
  if (repairSessions.length > 0) {
    console.log('');
    console.log(`Repair Sessions: ${repairSessions.length}`);
    for (const s of repairSessions) {
      console.log(`  ${s.agentName} (${s.status})`);
      if (s.error) console.log(`    Error: ${s.error}`);
    }
  }

  const lastFailed = [...sessions].reverse().find((s) => s.status === 'failed');
  if (lastFailed) {
    console.log('');
    console.log(`Final Failed Session: ${lastFailed.agentName}`);
    if (lastFailed.error) console.log(`  Error: ${lastFailed.error}`);
  }

  console.log('');
  console.log('Suggested Commands:');
  console.log(`  moreagent inspect --run ${run.id}`);
  for (const s of repairSessions.slice(0, 3)) {
    console.log(`  moreagent inspect --run ${run.id} --agent ${s.agentName}`);
  }
}

function readFileSafe(fp: string): string | null {
  try {
    const c = fs.readFileSync(fp, 'utf-8').trim();
    return c.length > 0 ? c : null;
  } catch { return null; }
}

function parseDecisionLine(c: string): string {
  if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(c)) return 'CHANGES_REQUESTED';
  if (/^Decision:\s*APPROVED\s*$/im.test(c)) return 'APPROVED';
  return 'unknown';
}

function parseResultLine(c: string): string {
  if (/^Result:\s*FAIL\s*$/im.test(c)) return 'FAIL';
  if (/^Result:\s*PASS\s*$/im.test(c)) return 'PASS';
  return 'unknown';
}
