import { readSessions } from '../session';
import { Run, Session } from '../types';

export interface StatusOptions {
  latest?: boolean;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_AGENT_ORDER = ['architect', 'implementer', 'tester', 'reviewer'];

export function statusCommand(options: StatusOptions = {}): void {
  const data = readSessions();
  const runs = [...data.runs].sort(compareRunsByCreatedAtDesc);

  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  if (options.latest) {
    printLatestRun(runs[0]);
    return;
  }

  printRunList(runs.slice(0, DEFAULT_LIMIT));
}

function printRunList(runs: Run[]): void {
  console.log(`Latest runs (${runs.length}):`);

  for (const run of runs) {
    console.log('');
    console.log(`${run.id}`);
    console.log(`  Task: ${run.task}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Created At: ${run.createdAt}`);
    console.log(`  Artifacts: ${run.artifactDir}`);

    const worktreePath = getRunWorktreePath(run);
    if (worktreePath) {
      console.log(`  Worktree: ${worktreePath}`);
    }

    console.log(`  Agents: ${formatAgentSummary(run.sessions)}`);
  }
}

function printLatestRun(run: Run): void {
  console.log('Latest run:');
  console.log(`  Run ID: ${run.id}`);
  console.log(`  Task: ${run.task}`);
  console.log(`  Status: ${run.status}`);
  console.log(`  Created At: ${run.createdAt}`);
  console.log(`  Artifacts: ${run.artifactDir}`);

  const worktreePath = getRunWorktreePath(run);
  if (worktreePath) {
    console.log(`  Worktree: ${worktreePath}`);
  }

  console.log(`  Agents: ${formatAgentSummary(run.sessions)}`);
  console.log('');
  console.log('Sessions:');

  for (const session of run.sessions) {
    console.log(`  ${session.agentName}`);
    console.log(`    Status: ${session.status}`);
    console.log(`    Started At: ${session.startedAt || 'N/A'}`);
    console.log(`    Completed At: ${session.completedAt || 'N/A'}`);
    console.log(`    Duration: ${formatSessionDuration(session)}`);
    console.log(`    Artifacts: ${session.artifactDir}`);
    if (session.worktreePath) {
      console.log(`    Worktree: ${session.worktreePath}`);
    }
    if (session.runtimeSessionId) {
      console.log(`    Runtime Session: ${session.runtimeSessionId}`);
    }
    if (session.error) {
      console.log(`    Error: ${session.error}`);
    }
  }
}

function compareRunsByCreatedAtDesc(a: Run, b: Run): number {
  return (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function getRunWorktreePath(run: Run): string | undefined {
  return run.sessions.find((session) => session.worktreePath)?.worktreePath;
}

function formatAgentSummary(sessions: Session[]): string {
  const orderedSessions = [...sessions].sort(compareSessionsForSummary);
  return orderedSessions
    .map((session) => `${session.agentName} ${formatSummaryStatus(session.status)}`)
    .join(', ');
}

function compareSessionsForSummary(a: Session, b: Session): number {
  return getAgentOrderIndex(a.agentName) - getAgentOrderIndex(b.agentName);
}

function getAgentOrderIndex(agentName: string): number {
  const index = DEFAULT_AGENT_ORDER.indexOf(agentName);
  return index === -1 ? DEFAULT_AGENT_ORDER.length : index;
}

function formatSummaryStatus(status: Session['status']): string {
  switch (status) {
    case 'completed':
      return 'OK';
    case 'failed':
      return 'FAIL';
    default:
      return 'PENDING';
  }
}

function formatSessionDuration(session: Session): string {
  if (!session.startedAt || !session.completedAt) {
    return 'N/A';
  }

  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 'N/A';
  }

  return `${Math.round((end - start) / 1000)}s`;
}
