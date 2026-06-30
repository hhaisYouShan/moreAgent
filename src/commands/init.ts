import * as fs from 'fs';
import * as path from 'path';
import { getMoreAgentDir, getOpenCodeAgentsDir } from '../config';

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
  - name: brain
    role: brain
    description: "Orchestrator — analyzes requirements, splits work, and reviews gates"
    primaryArtifact: brain-plan.md
    canModifyCode: false
    prompt: |
      You are an orchestrator agent. Analyze the user's task, break it into phases, produce a high-level plan, and review PRD/tech gates. You MUST include "Decision: APPROVED" or "Decision: CHANGES_REQUESTED" at the top of gate review artifacts.

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
  brain: buildOpenCodeAgentFile(
    'brain',
    'Orchestrator — analyzes requirements, splits work, reviews gates.',
    'You are an orchestrator agent. Analyze tasks, produce high-level plans, and review PRD/tech gates. You MUST include "Decision: APPROVED" or "Decision: CHANGES_REQUESTED" at the top of gate review artifacts.'
  ),
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

export interface InitOptions {
  fullBootstrap?: boolean;
}

export function initCommand(profile: InitProfile = 'mvp', options?: InitOptions): void {
  const dir = getMoreAgentDir();
  const isFull = profile === 'full';
  const modeLabel = isFull ? 'full' : 'mvp';
  const bootstrapLabel = (options?.fullBootstrap && isFull) ? ' (full-bootstrap)' : '';

  const configPath = path.join(dir, 'config.yaml');
  const existingConfig = fs.existsSync(configPath);
  const existingIsFull = existingConfig && fs.readFileSync(configPath, 'utf-8').includes('name: brain');

  // Block full additions if existing config is MVP (not full)
  const blockFullAdditions = isFull && existingConfig && !existingIsFull;

  console.log(`Initializing MoreAgent project (profile: ${modeLabel}${bootstrapLabel})...\n`);

  const created: string[] = [];
  const skipped: string[] = [];

  function ensureDir(p: string): void {
    if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); created.push(p); }
  }

  function ensureFile(p: string, content: string): void {
    if (!fs.existsSync(p)) { fs.writeFileSync(p, content, 'utf-8'); created.push(p); }
    else { skipped.push(p); }
  }

  // Core directories
  ensureDir(dir);
  ensureDir(path.join(dir, 'runs'));
  ensureDir(path.join(dir, 'worktrees'));

  // Config
  ensureFile(configPath, isFull ? FULL_CONFIG : MVP_CONFIG);

  // State files (always safe to create/ensure)
  ensureFile(path.join(dir, 'sessions.json'), JSON.stringify({ runs: [] }, null, 2));
  ensureFile(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [] }, null, 2));
  ensureFile(path.join(dir, 'runtime-sessions.json'), JSON.stringify({ provider: 'opencode', agents: {} }, null, 2));

  // Agents — block full agents if existing config is not full
  const agentsDir = getOpenCodeAgentsDir();
  ensureDir(agentsDir);
  if (blockFullAdditions) {
    console.log('\n⚠  Config already exists and is not a full workflow config.');
    console.log('   Full agents and integration guide skipped — manual migration required.');
  } else {
    const agents = isFull ? FULL_OPENCODE_AGENTS : MVP_OPENCODE_AGENTS;
    for (const [name, content] of Object.entries(agents)) {
      ensureFile(path.join(agentsDir, `${name}.md`), content);
    }

    // Integration guide (full only)
    if (isFull && options?.fullBootstrap) {
      ensureFile(path.join(dir, 'integration-guide.md'), buildIntegrationGuide());
    }
  }

  // Print summary
  if (created.length > 0) {
    console.log('Created:');
    for (const p of created) console.log('  ' + p);
  }
  if (skipped.length > 0) {
    console.log('\nSkipped (already exists):');
    for (const p of skipped) console.log('  ' + p);
  }

  console.log('\nNext:');
  console.log('  1. Review ' + configPath);
  if (isFull && !blockFullAdditions) {
    console.log('  2. Review ' + path.join(dir, 'integration-guide.md'));
    console.log('  3. Run: moreagent start --once --task "..."');
  } else {
    console.log('  2. Run: moreagent start --once --task "..."');
  }
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

function buildIntegrationGuide(): string {
  return `# MoreAgent Full Workflow Integration Guide

> Generated by \`moreagent init --full\`. This guide explains how to use the full 9-phase workflow in your project.

## Profile

**profile = full** — Uses brain, product, frontend, backend, tester, and reviewer agents.

## Full Workflow Phases (9)

1. **brain** — Orchestrator analyzes the task and creates high-level plan
2. **prd** — Product manager writes the Product Requirements Document
3. **prd-review** — Frontend and backend agents review the PRD
4. **prd-gate** — Brain reviews PRD feedback and decides APPROVED or CHANGES_REQUESTED
5. **tech-plan** — Frontend and backend agents create technical plans
6. **tech-gate** — Brain reviews tech plans and decides APPROVED or CHANGES_REQUESTED
7. **implementation** — Frontend and backend agents implement features
8. **test** — Tester runs tests and reports PASS or FAIL
9. **review** — Reviewer inspects code and decides APPROVED or CHANGES_REQUESTED

## Agent Roles

| Agent | Role | Modifies Code | Primary Artifact |
|-------|------|---------------|-----------------|
| brain | Orchestrator / Gate reviewer | No | brain-plan.md, prd-decision.md, tech-review.md |
| product | Product manager | No | prd.md |
| frontend | Frontend developer | Yes | frontend-plan.md, frontend-implementation.md |
| backend | Backend developer | Yes | backend-plan.md, backend-implementation.md |
| tester | QA engineer | Yes | test-report.md (must include Result: PASS or FAIL) |
| reviewer | Code reviewer | No | review-report.md (must include Decision: APPROVED or CHANGES_REQUESTED) |

## Recommended Commands

\`\`\`bash
# Run a single task through the full workflow
moreagent start --once --task "your task description"

# Resume the latest failed or running workflow
moreagent start --resume --latest

# Resume a specific run
moreagent start --resume --run <run-id>

# Check run status
moreagent status --latest
moreagent status --run <run-id>

# Get workflow report
moreagent report --latest
moreagent report --run <run-id> --json

# Visual dashboard
moreagent dashboard
moreagent dashboard --serve
moreagent dashboard --serve --watch
\`\`\`

## Directory Structure

| Path | Purpose |
|------|---------|
| .moreagent/config.yaml | Agent and runtime configuration |
| .moreagent/sessions.json | Session tracking (run history) |
| .moreagent/tasks.json | Task queue |
| .moreagent/runtime-sessions.json | OpenCode session mappings |
| .moreagent/runs/ | Per-run artifact output |
| .moreagent/worktrees/ | Git worktree directories |
| .moreagent/integration-guide.md | This document |
| .opencode/agents/ | OpenCode agent definitions |

## Adding to an Existing Project

1. Ensure you have a git repository.
2. Ensure OpenCode CLI is available in your PATH.
3. Run \`moreagent init --full\` from the repository root.
4. Review \`.moreagent/config.yaml\` and adjust agent settings if needed.
5. Review \`.opencode/agents/*.md\` and customize prompts for your project.
6. Start with a small task to verify the workflow.

## Safety Notes

- Worktree changes are isolated — agents work in separate git worktrees.
- No automatic merging — use \`moreagent merge\` to review and apply changes.
- Re-running \`moreagent init --full\` is safe — existing files are not overwritten.
- Config and agent files are not overwritten on repeated runs.
`;
}
