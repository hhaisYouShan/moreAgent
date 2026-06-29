import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readConfig, getMoreAgentDir } from '../config';
import {
  addRun,
  updateRun,
  updateSession,
  markRunningRunsAsStaleFailure,
} from '../session';
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
  const staleRuns = markRunningRunsAsStaleFailure();
  if (staleRuns > 0) {
    console.log(`Marked ${staleRuns} stale running run(s) as failed.`);
  }
  assertRuntimeExecutable(config.runtime.opencodePath);

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

  const needsWorktree = agents.some((a) => a.canModifyCode);
  const taskWorktree = needsWorktree ? createTaskWorktree(runId) : null;

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

  const artifactContexts: string[] = [];

  for (const agent of agents) {
    console.log(`--- Agent: ${agent.name} (${agent.role}) ---`);

    const session = sessions.find((s) => s.agentName === agent.name)!;
    const agentDir = path.join(runDir, agent.name);

    fs.mkdirSync(agentDir, { recursive: true });
    writeAllArtifactTemplates(agentDir);

    const context = buildContext(artifactContexts);
    writeTaskMarkdown(agentDir, agent.name, agent.role, options.task, context);

    const workingDir = resolveWorkingDir(agent, taskWorktree);

    session.status = 'running';
    session.startedAt = new Date().toISOString();
    if (workingDir !== process.cwd()) {
      session.worktreePath = workingDir;
    }
    updateSession(runId, session);

    const primaryArtifact = ROLE_ARTIFACT_MAP[agent.role] || 'output.md';

    try {
      const result = await adapter.execute({
        opencodePath: config.runtime.opencodePath,
        agentName: agent.name,
        sessionId: session.id,
        prompt: agent.prompt,
        task: options.task,
        primaryArtifact,
        workingDir,
        artifactDir: agentDir,
        timeout: config.runtime.timeout,
        context,
      });

      if (result.success) {
        session.status = 'completed';
        writeOutputToArtifactIfNeeded(agent, agentDir, result.output);
        const artifactContent = readPrimaryArtifact(agent, agentDir);
        if (artifactContent) {
          artifactContexts.push(
            `[${agent.name} (${agent.role})]\n${artifactContent}`
          );
        }
        console.log(`  Completed in ${(result.duration / 1000).toFixed(1)}s`);
      } else {
        session.status = 'failed';
        session.error = result.error;
        console.log(`  Failed: ${result.error}`);
        session.completedAt = new Date().toISOString();
        updateSession(runId, session);
        break;
      }
    } catch (err: any) {
      session.status = 'failed';
      session.error = err.message;
      console.log(`  Error: ${err.message}`);
      session.completedAt = new Date().toISOString();
      updateSession(runId, session);
      break;
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
  if (taskWorktree) {
    console.log(`Worktree: ${taskWorktree}`);
  }
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

const ROLE_ARTIFACT_MAP: Record<string, string> = {
  architect: 'brain-plan.md',
  implementer: 'implementation-result.md',
  tester: 'test-report.md',
  reviewer: 'review-report.md',
};

function createTaskWorktree(runId: string): string | null {
  const branchName = `agent/${runId}`;
  const worktreesDir = path.join(getMoreAgentDir(), 'worktrees');
  const worktreePath = path.join(worktreesDir, `agent-${runId}`);

  if (fs.existsSync(worktreePath)) {
    console.log(`  Reusing task worktree: ${worktreePath}\n`);
    return worktreePath;
  }

  ensureRepoHasCommits();

  try {
    const { execSync } = require('child_process');
    const baseBranch = getCurrentBranch();
    execSync(
      `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
      { cwd: process.cwd(), stdio: 'pipe' }
    );
    console.log(`  Created task worktree: ${worktreePath}`);
    console.log(`  Branch: ${branchName}\n`);
    return worktreePath;
  } catch (err: any) {
    throw new Error(
      `Failed to create git worktree for task branch "${branchName}".\n` +
        `Error: ${err.message}\n\n` +
        `To fix this:\n` +
        `  1. Make sure this is a git repository: git init\n` +
        `  2. Create at least one commit: git add . && git commit -m "Initial commit"\n` +
        `  3. Check the current branch exists: git rev-parse --abbrev-ref HEAD\n` +
        `  4. Remove stale worktrees: git worktree list && git worktree prune`
    );
  }
}

function ensureRepoHasCommits(): void {
  try {
    const { execSync } = require('child_process');
    execSync('git rev-parse HEAD', {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
  } catch {
    console.log('  No commits found. Creating initial commit for worktree support...');
    try {
      const { execSync } = require('child_process');
      execSync('git add -A', { cwd: process.cwd(), stdio: 'pipe' });
      execSync('git commit -m "Initial commit (moreagent worktree baseline)"', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      console.log('  Initial commit created.\n');
    } catch (err: any) {
      throw new Error(
        `Cannot create git worktree: no commits in repository and failed to create initial commit (${err.message}). Run "git add . && git commit -m Initial" first.`
      );
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

function resolveWorkingDir(
  agent: AgentConfig,
  taskWorktree: string | null
): string {
  if (agent.canModifyCode && taskWorktree) {
    return taskWorktree;
  }
  return process.cwd();
}

function assertRuntimeExecutable(command: string): void {
  if (command.includes(path.sep)) {
    assertExecutablePath(command);
    return;
  }

  const pathValue = process.env.PATH || '';
  const searchPaths = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of searchPaths) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate) && isExecutable(candidate)) {
      return;
    }
  }

  if (process.platform === 'win32') {
    const pathExt = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean);
    for (const dir of searchPaths) {
      for (const ext of pathExt) {
        const candidate = path.join(dir, `${command}${ext}`);
        if (fs.existsSync(candidate)) {
          return;
        }
      }
    }
  }

  throw new Error(
    `OpenCode executable not found: "${command}". Update runtime.opencodePath in .moreagent/config.yaml or add it to PATH.`
  );
}

function assertExecutablePath(commandPath: string): void {
  const resolvedPath = path.resolve(commandPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `OpenCode executable not found at "${resolvedPath}". Update runtime.opencodePath in .moreagent/config.yaml.`
    );
  }
  if (!isExecutable(resolvedPath)) {
    throw new Error(
      `OpenCode executable is not runnable at "${resolvedPath}". Update runtime.opencodePath in .moreagent/config.yaml.`
    );
  }
}

function isExecutable(filePath: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildContext(artifactContexts: string[]): string {
  if (artifactContexts.length === 0) {
    return '';
  }
  return artifactContexts.join('\n\n---\n\n');
}

function isArtifactStillTemplate(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return true;

  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.trim().length === 0) return true;

  return content.includes('<!--');
}

function readPrimaryArtifact(
  agent: AgentConfig,
  agentDir: string
): string | null {
  const artifactName = ROLE_ARTIFACT_MAP[agent.role];
  if (!artifactName) return null;

  const filePath = path.join(agentDir, artifactName);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.trim().length === 0) return null;

  return content;
}

function writeOutputToArtifactIfNeeded(
  agent: AgentConfig,
  agentDir: string,
  stdout: string
): void {
  const artifactName = ROLE_ARTIFACT_MAP[agent.role];
  if (!artifactName) return;

  const filePath = path.join(agentDir, artifactName);

  if (!isArtifactStillTemplate(filePath)) {
    return;
  }

  const title = artifactName
    .replace('.md', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const content = `# ${title}

## Agent: ${agent.name} (${agent.role})

## Output

${stdout}
`;
  updateArtifact(agentDir, artifactName as any, content);
}

function printSummary(sessions: Session[]): void {
  console.log('\n--- Session Summary ---');
  for (const s of sessions) {
    const status = s.status === 'completed' ? 'OK' : 'FAIL';
    const duration = s.completedAt
      ? ` (${Math.round(
          (new Date(s.completedAt).getTime() -
            new Date(s.startedAt).getTime()) /
            1000
        )}s)`
      : '';
    console.log(`  ${s.agentName}: ${status}${duration}`);
    if (s.error) {
      console.log(`    Error: ${s.error}`);
    }
  }
}
