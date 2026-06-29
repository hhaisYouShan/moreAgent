import * as fs from 'fs';
import * as path from 'path';
import { getMoreAgentDir } from './config';

export interface AgentRuntimeSession {
  runtimeSessionId: string;
  updatedAt: string;
}

export interface RuntimeSessionRegistry {
  provider: 'opencode';
  agents: Record<string, AgentRuntimeSession>;
}

const FILE_NAME = 'runtime-sessions.json';

function getRegistryPath(): string {
  return path.join(getMoreAgentDir(), FILE_NAME);
}

function readRegistry(): RuntimeSessionRegistry {
  const p = getRegistryPath();
  if (!fs.existsSync(p)) {
    return { provider: 'opencode', agents: {} };
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeRegistry(reg: RuntimeSessionRegistry): void {
  fs.writeFileSync(getRegistryPath(), JSON.stringify(reg, null, 2), 'utf-8');
}

export function getAgentRuntimeSessionId(agentName: string): string | null {
  const reg = readRegistry();
  return reg.agents[agentName]?.runtimeSessionId ?? null;
}

export function setAgentRuntimeSessionId(
  agentName: string,
  runtimeSessionId: string
): void {
  const reg = readRegistry();
  reg.agents[agentName] = {
    runtimeSessionId,
    updatedAt: new Date().toISOString(),
  };
  writeRegistry(reg);
}

export function initRuntimeSessionRegistry(): void {
  const p = getRegistryPath();
  if (!fs.existsSync(p)) {
    writeRegistry({ provider: 'opencode', agents: {} });
  }
}
