import * as fs from 'fs';
import * as path from 'path';
import { readSessions } from '../session';
import { Run, Session } from '../types';

export interface InspectOptions {
  run?: string;
  agent?: string;
}

export function inspectCommand(options: InspectOptions = {}): void {
  const run = findRun(options.run);
  if (!run) {
    console.log('No runs found.');
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
