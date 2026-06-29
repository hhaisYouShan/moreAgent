import * as fs from 'fs';
import * as path from 'path';
import {
  getMoreAgentDir,
  configExists,
  getOpenCodeAgentsDir,
} from '../config';
import { initTasksFile } from '../queue';
import { initRuntimeSessionRegistry } from '../runtimeSessions';

export type InitProfile = 'mvp' | 'full';

const MVP_CONFIG = `# MoreAgent Configuration
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

const FULL_CONFIG = `# MoreAgent Configuration
version: "1.0"

project:
  name: ""
  description: ""

agents:
  - name: product
    role: product
    description: "Product manager — writes PRD and clarifies requirements"
    primaryArtifact: prd.md
    canModifyCode: false
    prompt: |
      You are a product manager. Your role is to clarify requirements, define scope, write clear acceptance criteria, and produce a Product Requirements Document (PRD). Do not modify code.

  - name: frontend
    role: frontend
    description: "Frontend developer — designs and implements frontend"
    primaryArtifact: frontend-plan.md
    canModifyCode: true
    dependsOn:
      - product
    prompt: |
      You are a frontend developer. Implement frontend features based on the PRD. Focus on component architecture, routing, state management, and UI implementation.

  - name: backend
    role: backend
    description: "Backend developer — designs and implements backend"
    primaryArtifact: backend-plan.md
    canModifyCode: true
    dependsOn:
      - product
    prompt: |
      You are a backend developer. Implement backend features based on the PRD. Focus on API design, data modeling, and service implementation.

  - name: tester
    role: tester
    description: "Tests the implementation"
    primaryArtifact: test-report.md
    canModifyCode: true
    branch: feature/tests
    dependsOn:
      - frontend
      - backend
    prompt: |
      You are a QA engineer. Write and run tests for the implementation. Report results and coverage. You MUST include "Result: PASS" or "Result: FAIL" at the top of your report.

  - name: reviewer
    role: reviewer
    description: "Reviews code and tests"
    primaryArtifact: review-report.md
    canModifyCode: false
    dependsOn:
      - tester
    prompt: |
      You are a senior code reviewer. Review the implementation and tests. Provide actionable feedback. You MUST include "Decision: APPROVED" or "Decision: CHANGES_REQUESTED" at the top of your report.

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

const MVP_OPENCODE_AGENTS: Record<string, string> = {
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

const FULL_OPENCODE_AGENTS: Record<string, string> = {
  product: buildOpenCodeAgentFile(
    'product',
    'Product manager — writes PRD, clarifies requirements, defines acceptance criteria.',
    'You are a product manager. Write a clear PRD with scope, user stories, and acceptance criteria. Do not modify code.'
  ),
  frontend: buildOpenCodeAgentFile(
    'frontend',
    'Frontend developer — designs and implements frontend features.',
    'You are a frontend developer. Implement UI features based on the PRD. Focus on component architecture and user experience.'
  ),
  backend: buildOpenCodeAgentFile(
    'backend',
    'Backend developer — designs and implements backend features.',
    'You are a backend developer. Implement server-side features based on the PRD. Focus on API design and data modeling.'
  ),
  tester: buildOpenCodeAgentFile(
    'tester',
    'Tests the implementation and reports results. Must include Result: PASS or Result: FAIL.',
    'You are a QA engineer. Write tests, run them, and report results. You MUST include exactly one of "Result: PASS" or "Result: FAIL" at the top of your report.'
  ),
  reviewer: buildOpenCodeAgentFile(
    'reviewer',
    'Reviews code and tests. Must include Decision: APPROVED or Decision: CHANGES_REQUESTED.',
    'You are a senior code reviewer. Review implementation and test coverage. You MUST include exactly one of "Decision: APPROVED" or "Decision: CHANGES_REQUESTED" at the top of your report.'
  ),
};

export function initCommand(profile: InitProfile = 'mvp'): void {
  const dir = getMoreAgentDir();

  if (fs.existsSync(dir)) {
    console.log(`.moreagent/ already exists at ${dir}`);
    ensureOpenCodeAgents(profile);
    initTasksFile();
    initRuntimeSessionRegistry();
    if (configExists()) {
      console.log('Config already exists. Run "moreagent start" to begin.');
      return;
    }
  }

  console.log(`Initializing MoreAgent project (profile: ${profile})...`);

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'worktrees'), { recursive: true });
  ensureOpenCodeAgents(profile);

  const configPath = path.join(dir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      profile === 'full' ? FULL_CONFIG : MVP_CONFIG,
      'utf-8'
    );
  }

  const sessionsPath = path.join(dir, 'sessions.json');
  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify({ runs: [] }, null, 2),
      'utf-8'
    );
  }

  initTasksFile();
  initRuntimeSessionRegistry();

  console.log(`\nInitialized at ${dir}`);
  console.log('Created:');
  console.log('  config.yaml     — Agent and runtime configuration');
  console.log('  sessions.json   — Session tracking');
  console.log('  tasks.json      — Task queue');
  console.log('  runs/           — Run output directory');
  console.log('  worktrees/      — Git worktree directory');
  console.log('  .opencode/agents/ — OpenCode agent definitions');
  console.log('\nNext: edit config.yaml with your project details, then run:');
  console.log('  moreagent start --once --task "your task description"');
}

function ensureOpenCodeAgents(profile: InitProfile): void {
  const agentsDir = getOpenCodeAgentsDir();
  fs.mkdirSync(agentsDir, { recursive: true });

  const agents =
    profile === 'full' ? FULL_OPENCODE_AGENTS : MVP_OPENCODE_AGENTS;

  for (const [name, content] of Object.entries(agents)) {
    const agentPath = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(agentPath)) {
      fs.writeFileSync(agentPath, content, 'utf-8');
    }
  }
}
