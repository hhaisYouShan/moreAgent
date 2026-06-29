import * as fs from 'fs';
import * as path from 'path';
import { SessionsData, Run, Session } from './types';
import { getMoreAgentDir } from './config';

const SESSIONS_FILE = 'sessions.json';

function getSessionsPath(): string {
  return path.join(getMoreAgentDir(), SESSIONS_FILE);
}

export function readSessions(): SessionsData {
  const sessionsPath = getSessionsPath();
  if (!fs.existsSync(sessionsPath)) {
    return { runs: [] };
  }
  const content = fs.readFileSync(sessionsPath, 'utf-8');
  return JSON.parse(content) as SessionsData;
}

export function writeSessions(data: SessionsData): void {
  const sessionsPath = getSessionsPath();
  fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function addRun(run: Run): void {
  const data = readSessions();
  data.runs.push(run);
  writeSessions(data);
}

export function updateRun(run: Run): void {
  const data = readSessions();
  const index = data.runs.findIndex((r) => r.id === run.id);
  if (index !== -1) {
    data.runs[index] = run;
  }
  writeSessions(data);
}

export function updateSession(runId: string, session: Session): void {
  const data = readSessions();
  const run = data.runs.find((r) => r.id === runId);
  if (run) {
    const idx = run.sessions.findIndex((s) => s.id === session.id);
    if (idx !== -1) {
      run.sessions[idx] = session;
    }
  }
  writeSessions(data);
}
