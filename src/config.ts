import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MoreAgentConfig } from './types';

const MOREGENT_DIR = '.moreagent';
const CONFIG_FILE = 'config.yaml';

export function getMoreAgentDir(): string {
  return path.resolve(process.cwd(), MOREGENT_DIR);
}

export function getConfigPath(): string {
  return path.join(getMoreAgentDir(), CONFIG_FILE);
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function readConfig(): MoreAgentConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. Run 'moreagent init' first.`
    );
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.load(content) as MoreAgentConfig;

  validateConfig(config);
  return config;
}

function validateConfig(config: MoreAgentConfig): void {
  if (!config.version) {
    throw new Error('Config is missing "version" field');
  }
  if (!config.agents || config.agents.length === 0) {
    throw new Error('Config must have at least one agent');
  }
  if (!config.runtime) {
    throw new Error('Config is missing "runtime" section');
  }
  if (!config.runtime.opencodePath) {
    throw new Error('Config is missing "runtime.opencodePath"');
  }

  const names = new Set<string>();
  for (const agent of config.agents) {
    if (!agent.name) {
      throw new Error('Each agent must have a "name"');
    }
    if (!agent.prompt) {
      throw new Error(`Agent "${agent.name}" is missing a "prompt"`);
    }
    if (names.has(agent.name)) {
      throw new Error(`Duplicate agent name: "${agent.name}"`);
    }
    names.add(agent.name);
  }
}
