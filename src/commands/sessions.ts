import { getMoreAgentDir } from '../config';
import {
  readFullRegistry,
  resetAgentRuntimeSession,
  resetAllRuntimeSessions,
} from '../runtimeSessions';
import * as fs from 'fs';

function checkInit(): void {
  const dir = getMoreAgentDir();
  if (!fs.existsSync(dir)) {
    throw new Error(
      'MoreAgent is not initialized in this directory.\n' +
        'Run: moreagent init'
    );
  }
}

export function sessionsListCommand(): void {
  checkInit();
  const reg = readFullRegistry();
  const names = Object.keys(reg.agents);

  if (names.length === 0) {
    console.log('No runtime sessions found.');
    return;
  }

  console.log('Agent Runtime Sessions:');
  for (const name of names) {
    const entry = reg.agents[name];
    console.log(`  ${name}`);
    console.log(`    Runtime Session: ${entry.runtimeSessionId}`);
    console.log(`    Updated At: ${entry.updatedAt}`);
  }
}

export function sessionsResetCommand(agentName: string): void {
  checkInit();
  const removed = resetAgentRuntimeSession(agentName);
  if (removed) {
    console.log(`Reset runtime session for agent: ${agentName}`);
  } else {
    console.log(`No runtime session found for agent: ${agentName}`);
  }
}

export function sessionsResetAllCommand(): void {
  checkInit();
  resetAllRuntimeSessions();
  console.log('All runtime sessions reset.');
}

export function sessionsExportCommand(jsonOnly?: boolean): void {
  checkInit();
  const reg = readFullRegistry();

  if (jsonOnly) {
    console.log(JSON.stringify(reg, null, 2));
    return;
  }

  console.log(JSON.stringify(reg, null, 2));
  console.log('');
  console.log(
    'These are MoreAgent mappings only. OpenCode native sessions remain in OpenCode storage.'
  );
}
