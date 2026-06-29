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
    const primaryName = PRIMARY_ARTIFACT_MAP[session.agentName.replace(/^repair-\d+-/, '')];
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

  const roleName = session.agentName.replace(/^repair-\d+-/, '');
  const primaryName = PRIMARY_ARTIFACT_MAP[roleName];

  if (!primaryName) {
    console.log(`No primary artifact defined for role "${roleName}".`);
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
};

function getWorktreePath(run: Run): string | undefined {
  for (const session of run.sessions) {
    if (session.worktreePath && fs.existsSync(session.worktreePath)) {
      return session.worktreePath;
    }
  }
  return run.sessions.find((s) => s.worktreePath)?.worktreePath;
}
