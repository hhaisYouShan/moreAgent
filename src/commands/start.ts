import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readConfig, getMoreAgentDir } from '../config';
import { addRun, updateRun, updateSession } from '../session';
import { writeAllArtifactTemplates, writeTaskMarkdown, updateArtifact } from '../artifacts';
import { OpenCodeRuntimeAdapter } from '../runtime/adapter';
import { Run, Session, AgentConfig } from '../types';

export interface StartOptions {
  once: boolean;
  task: string;
  agent?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const config = readConfig();
  const runId = generateRunId();
  const runDir = path.join(getMoreAgentDir(), 'runs', runId);

  console.log(`Starting run: ${runId}`);
  console.log(`Task: ${options.task}`);
  console.log(`Agents: ${config.agents.map((a) => a.name).join(', ')}\n`);

  fs.mkdirSync(runDir, { recursive: true });

  const agents = options.agent
    ? config.agents.filter((a) => a.name === options.agent)
    : config.agents;

  if (agents.length === 0) {
    throw new Error(`No agent found with name "${options.agent}"`);
  }

  const run: Run = {
    id: runId,
    task: options.task,
    status: 'running',
    createdAt: new Date().toISOString(),
    artifactDir: runDir,
    sessions: [],
  };

  const sessions = agents.map((agent) => createSession(agent, runId, runDir));
  run.sessions = sessions;
  addRun(run);

  const adapter = new OpenCodeRuntimeAdapter();

  let previousOutput = '';

  for (const agent of agents) {
    console.log(`--- Agent: ${agent.name} (${agent.role}) ---`);

    const session = sessions.find((s) => s.agentName === agent.name)!;
    const agentDir = path.join(runDir, agent.name);

    fs.mkdirSync(agentDir, { recursive: true });
    writeAllArtifactTemplates(agentDir);
    writeTaskMarkdown(agentDir, agent.name, agent.role, options.task, previousOutput);

    const worktreePath = setupWorktree(agent, runId);

    let workingDir = process.cwd();
    if (worktreePath) {
      workingDir = worktreePath;
      const sessionToUpdate = sessions.find((s) => s.agentName === agent.name)!;
      sessionToUpdate.worktreePath = worktreePath;
    }

    session.status = 'running';
    session.startedAt = new Date().toISOString();
    updateSession(runId, session);

    try {
      const result = await adapter.execute({
        opencodePath: config.runtime.opencodePath,
        agentName: agent.name,
        prompt: agent.prompt,
        task: options.task,
        workingDir,
        artifactDir: agentDir,
        timeout: config.runtime.timeout,
        context: previousOutput,
      });

      if (result.success) {
        session.status = 'completed';
        previousOutput = result.output;
        await saveAgentOutput(agent, agentDir, result.output);
        console.log(`  Completed in ${(result.duration / 1000).toFixed(1)}s`);
      } else {
        session.status = 'failed';
        session.error = result.error;
        console.log(`  Failed: ${result.error}`);
      }
    } catch (err: any) {
      session.status = 'failed';
      session.error = err.message;
      console.log(`  Error: ${err.message}`);
    }

    session.completedAt = new Date().toISOString();
    updateSession(runId, session);
    console.log('');
  }

  run.status = sessions.every((s) => s.status === 'completed')
    ? 'completed'
    : 'failed';
  run.sessions = sessions;
  updateRun(run);

  console.log(`Run ${runId} ${run.status}`);
  console.log(`Artifacts: ${runDir}`);
  printSummary(sessions);
}

function createSession(
  agent: AgentConfig,
  runId: string,
  runDir: string
): Session {
  return {
    id: `${agent.name}-${runId}`,
    agentName: agent.name,
    runId,
    status: 'pending',
    artifactDir: path.join(runDir, agent.name),
    startedAt: '',
  };
}

function generateRunId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `run-${dateStr}-${uuidv4().slice(0, 6)}`;
}

function setupWorktree(
  agent: AgentConfig,
  runId: string
): string | null {
  if (!agent.canModifyCode) {
    return null;
  }

  const worktreesDir = path.join(getMoreAgentDir(), 'worktrees');
  const worktreeName = `${agent.name}-${runId}`;
  const worktreePath = path.join(worktreesDir, worktreeName);

  if (fs.existsSync(worktreePath)) {
    console.log(`  Reusing worktree: ${worktreePath}`);
    return worktreePath;
  }

  const branch = agent.branch || `feature/${agent.name}`;

  try {
    const { execSync } = require('child_process');

    execSync(`git worktree add "${worktreePath}" "${branch}"`, {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    console.log(`  Created worktree: ${worktreePath} (branch: ${branch})`);
    return worktreePath;
  } catch (err: any) {
    try {
      const { execSync } = require('child_process');
      const baseBranch = getCurrentBranch();
      execSync(`git worktree add -b "${branch}" "${worktreePath}" "${baseBranch}"`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      console.log(`  Created worktree with new branch: ${worktreePath} (branch: ${branch})`);
      return worktreePath;
    } catch (err2: any) {
      console.log(`  Warning: Could not create git worktree: ${err2.message}`);
      console.log(`  Running in current directory instead.`);
      return null;
    }
  }
}

function getCurrentBranch(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'main';
  }
}

async function saveAgentOutput(
  agent: AgentConfig,
  agentDir: string,
  output: string
): Promise<void> {
  const contentMap: Record<string, string> = {
    architect: 'brain-plan.md',
    implementer: 'implementation-result.md',
    tester: 'test-report.md',
    reviewer: 'review-report.md',
  };

  const artifactName = contentMap[agent.role];
  if (artifactName) {
    updateArtifact(
      agentDir,
      artifactName as any,
      `# ${artifactName.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}

## Agent: ${agent.name} (${agent.role})

## Agent Output

\`\`\`
${output}
\`\`\`
`
    );
  }
}

function printSummary(sessions: Session[]): void {
  console.log('\n--- Session Summary ---');
  for (const s of sessions) {
    const status = s.status === 'completed' ? 'OK' : 'FAIL';
    const duration = s.completedAt
      ? ` (${Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s)`
      : '';
    console.log(`  ${s.agentName}: ${status}${duration}`);
    if (s.error) {
      console.log(`    Error: ${s.error}`);
    }
  }
}
