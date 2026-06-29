import * as fs from 'fs';
import * as path from 'path';
import {
  getMoreAgentDir,
  configExists,
  getOpenCodeAgentsDir,
} from '../config';

const DEFAULT_CONFIG = `# MoreAgent Configuration
version: "1.0"

project:
  name: ""
  description: ""

agents:
  - name: architect
    role: architect
    description: "Designs architecture and creates implementation plan"
    canModifyCode: false
    prompt: |
      You are a senior software architect. Analyze the task, design the solution architecture, and create a detailed implementation plan.

  - name: implementer
    role: implementer
    description: "Implements the solution"
    canModifyCode: true
    branch: feature/implementation
    dependsOn:
      - architect
    prompt: |
      You are a senior software developer. Implement the solution based on the architect's plan. Write clean, well-structured code.

  - name: tester
    role: tester
    description: "Tests the implementation"
    canModifyCode: true
    branch: feature/tests
    dependsOn:
      - implementer
    prompt: |
      You are a QA engineer. Write and run tests for the implementation. Report results and coverage.

  - name: reviewer
    role: reviewer
    description: "Reviews code and tests"
    canModifyCode: false
    dependsOn:
      - tester
    prompt: |
      You are a senior code reviewer. Review the implementation and tests. Provide actionable feedback.

runtime:
  opencodePath: "opencode"
  timeout: 1800
  maxRetries: 2
`;

function buildOpenCodeAgentFile(
  name: string,
  description: string,
  prompt: string
): string {
  return `---
description: ${description}
---

${prompt}
`;
}

const DEFAULT_OPENCODE_AGENTS: Record<string, string> = {
  architect: buildOpenCodeAgentFile(
    'architect',
    'Designs architecture and creates implementation plans.',
    'You are a senior software architect. Analyze the task, design the solution architecture, and create a detailed implementation plan.'
  ),
  implementer: buildOpenCodeAgentFile(
    'implementer',
    'Implements the solution based on the architecture plan.',
    'You are a senior software developer. Implement the solution based on the architect plan. Keep changes minimal and focused.'
  ),
  tester: buildOpenCodeAgentFile(
    'tester',
    'Tests the implementation and reports results.',
    'You are a QA engineer. Verify the implementation, run tests, and report pass/fail status with evidence.'
  ),
  reviewer: buildOpenCodeAgentFile(
    'reviewer',
    'Reviews the final implementation and test coverage.',
    'You are a senior code reviewer. Review the final diff, identify risks, and provide actionable findings.'
  ),
};

export function initCommand(): void {
  const dir = getMoreAgentDir();

  if (fs.existsSync(dir)) {
    console.log(`.moreagent/ already exists at ${dir}`);
    ensureOpenCodeAgents();
    if (configExists()) {
      console.log('Config already exists. Run "moreagent start" to begin.');
      return;
    }
  }

  console.log('Initializing MoreAgent project...');

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'worktrees'), { recursive: true });
  ensureOpenCodeAgents();

  const configPath = path.join(dir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, DEFAULT_CONFIG, 'utf-8');
  }

  const sessionsPath = path.join(dir, 'sessions.json');
  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify({ runs: [] }, null, 2),
      'utf-8'
    );
  }

  console.log(`\nInitialized at ${dir}`);
  console.log('Created:');
  console.log('  config.yaml     — Agent and runtime configuration');
  console.log('  sessions.json   — Session tracking');
  console.log('  runs/           — Run output directory');
  console.log('  worktrees/      — Git worktree directory');
  console.log('  .opencode/agents/ — OpenCode agent definitions');
  console.log('\nNext: edit config.yaml with your project details, then run:');
  console.log('  moreagent start --once --task "your task description"');
}

function ensureOpenCodeAgents(): void {
  const agentsDir = getOpenCodeAgentsDir();
  fs.mkdirSync(agentsDir, { recursive: true });

  for (const [name, content] of Object.entries(DEFAULT_OPENCODE_AGENTS)) {
    const agentPath = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(agentPath)) {
      fs.writeFileSync(agentPath, content, 'utf-8');
    }
  }
}
