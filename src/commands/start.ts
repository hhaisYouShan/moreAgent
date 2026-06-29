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
import { writePrimaryArtifactTemplate, writeTaskMarkdown, updateArtifact } from '../artifacts';
import { OpenCodeRuntimeAdapter } from '../runtime/adapter';
import { Run, Session, AgentConfig } from '../types';

export interface StartOptions {
  once: boolean;
  task: string;
  agent?: string;
  loop?: boolean;
}

export interface TaskRunResult {
  runId: string;
  status: 'completed' | 'failed';
  artifactDir: string;
  worktreePath: string | null;
}

const MAX_REPAIR_ROUNDS = 2;

export async function startCommand(options: StartOptions): Promise<void> {
  if (options.loop) {
    await loopCommand();
    return;
  }

  const result = await runTaskOnce(options);
  console.log(`Run ${result.runId} ${result.status}`);
  console.log(`Artifacts: ${result.artifactDir}`);
  if (result.worktreePath) {
    console.log(`Worktree: ${result.worktreePath}`);
  }
}

async function loopCommand(): Promise<void> {
  const { getNextPendingTask, markTaskRunning, markTaskCompleted, markTaskFailed } = require('../queue');

  const config = readConfig();
  assertRuntimeExecutable(config.runtime.opencodePath);

  let processedCount = 0;

  while (true) {
    const task = getNextPendingTask();
    if (!task) {
      if (processedCount === 0) {
        console.log('No pending tasks in queue.');
        console.log('Add one with: moreagent queue add --task "your task"');
      } else {
        console.log(`\nAll ${processedCount} pending task(s) processed. Queue is empty.`);
      }
      return;
    }

    console.log(`\n=== Processing task: ${task.id} ===`);
    console.log(`Description: ${task.description}`);

    markTaskRunning(task.id);

    try {
      const result = await runTaskOnce({ once: true, task: task.description });
      if (result.status === 'completed') {
        markTaskCompleted(task.id, result.runId);
        console.log(`Task ${task.id} completed (run ${result.runId})`);
      } else {
        markTaskFailed(task.id, result.runId, 'Run failed');
        console.log(`Task ${task.id} failed (run ${result.runId})`);
      }
    } catch (err: any) {
      markTaskFailed(task.id, '', err.message);
      console.log(`Task ${task.id} error: ${err.message}`);
    }

    processedCount++;
  }
}

export async function runTaskOnce(options: StartOptions): Promise<TaskRunResult> {
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
  const agentByRole = new Map(agents.map((agent) => [agent.role, agent]));
  const hasRepairFlow =
    !options.agent &&
    agentByRole.has('implementer') &&
    agentByRole.has('tester') &&
    agentByRole.has('reviewer');

  const pipelineSucceeded = hasRepairFlow
    ? await runRepairPipeline({
      config,
      options,
      run,
      runDir,
      taskWorktree,
      agents,
      adapter,
      artifactContexts,
    })
    : await runSequentialPipeline({
      config,
      options,
      run,
      runDir,
      taskWorktree,
      agents,
      adapter,
      artifactContexts,
    });

  run.status = pipelineSucceeded ? 'completed' : 'failed';
  updateRun(run);

  printSummary(sessions);

  return {
    runId,
    status: run.status as 'completed' | 'failed',
    artifactDir: runDir,
    worktreePath: taskWorktree,
  };
}

interface PipelineContext {
  config: ReturnType<typeof readConfig>;
  options: StartOptions;
  run: Run;
  runDir: string;
  taskWorktree: string | null;
  agents: AgentConfig[];
  adapter: OpenCodeRuntimeAdapter;
  artifactContexts: string[];
}

interface AgentRunResult {
  session: Session;
  success: boolean;
  artifactContent?: string;
  agentDir: string;
}

interface ArtifactDecision {
  passed: boolean;
  reason?: string;
}

async function runSequentialPipeline(ctx: PipelineContext): Promise<boolean> {
  for (const agent of ctx.agents) {
    const session = ctx.run.sessions.find((s) => s.agentName === agent.name)!;
    const result = await executeAgentSession({
      ...ctx,
      agent,
      session,
      sessionName: agent.name,
      extraContext: '',
    });

    if (!result.success) {
      return false;
    }
  }

  return true;
}

async function runRepairPipeline(ctx: PipelineContext): Promise<boolean> {
  const architect = ctx.agents.find((agent) => agent.role === 'architect');
  const implementer = ctx.agents.find((agent) => agent.role === 'implementer')!;
  const tester = ctx.agents.find((agent) => agent.role === 'tester')!;
  const reviewer = ctx.agents.find((agent) => agent.role === 'reviewer')!;

  if (architect) {
    const architectSession = ctx.run.sessions.find(
      (session) => session.agentName === architect.name
    )!;
    const architectResult = await executeAgentSession({
      ...ctx,
      agent: architect,
      session: architectSession,
      sessionName: architect.name,
      extraContext: '',
    });
    if (!architectResult.success) {
      return false;
    }
  }

  const implementerSession = ctx.run.sessions.find(
    (session) => session.agentName === implementer.name
  )!;
  const initialImplementerResult = await executeAgentSession({
    ...ctx,
    agent: implementer,
    session: implementerSession,
    sessionName: implementer.name,
    extraContext: '',
  });
  if (!initialImplementerResult.success) {
    return false;
  }

  let repairRound = 0;
  let shouldRunRepairReviewer = false;

  while (true) {
    const testerSessionName =
      repairRound === 0 ? tester.name : `repair-${repairRound}-${tester.role}`;
    const testerSession = ensureSessionForRun(
      ctx.run,
      tester,
      testerSessionName,
      ctx.runDir
    );

    const testerResult = await executeAgentSession({
      ...ctx,
      agent: tester,
      session: testerSession,
      sessionName: testerSessionName,
      extraContext: '',
    });

    if (!testerResult.success) {
      if (repairRound >= MAX_REPAIR_ROUNDS) {
        return false;
      }

      repairRound += 1;
      const repairImplementer = await runRepairImplementer(
        ctx,
        implementer,
        repairRound,
        testerResult
      );
      if (!repairImplementer.success) {
        return false;
      }
      shouldRunRepairReviewer = false;
      continue;
    }

    const reviewerSessionName =
      shouldRunRepairReviewer
        ? `repair-${repairRound}-${reviewer.role}`
        : reviewer.name;
    const reviewerSession = ensureSessionForRun(
      ctx.run,
      reviewer,
      reviewerSessionName,
      ctx.runDir
    );

    const reviewerResult = await executeAgentSession({
      ...ctx,
      agent: reviewer,
      session: reviewerSession,
      sessionName: reviewerSessionName,
      extraContext: '',
    });

    if (reviewerResult.success) {
      return true;
    }

    if (repairRound >= MAX_REPAIR_ROUNDS) {
      return false;
    }

    repairRound += 1;
    const repairImplementer = await runRepairImplementer(
      ctx,
      implementer,
      repairRound,
      reviewerResult
    );
    if (!repairImplementer.success) {
      return false;
    }
    shouldRunRepairReviewer = true;
  }
}

async function runRepairImplementer(
  ctx: PipelineContext,
  implementer: AgentConfig,
  repairRound: number,
  failedResult: AgentRunResult
): Promise<AgentRunResult> {
  const repairSessionName = `repair-${repairRound}-${implementer.role}`;
  const repairSession = ensureSessionForRun(
    ctx.run,
    implementer,
    repairSessionName,
    ctx.runDir
  );

  return executeAgentSession({
    ...ctx,
    agent: implementer,
    session: repairSession,
    sessionName: repairSessionName,
    extraContext: buildFailureContext(
      failedResult.session.agentName,
      failedResult.agentDir,
      failedResult.session.error
    ),
  });
}

async function executeAgentSession(
  ctx: PipelineContext & {
    agent: AgentConfig;
    session: Session;
    sessionName: string;
    extraContext: string;
  }
): Promise<AgentRunResult> {
  const { agent, session, sessionName, extraContext } = ctx;

  console.log(`--- Agent: ${sessionName} (${agent.role}) ---`);

  const agentDir = path.join(ctx.runDir, sessionName);
  fs.mkdirSync(agentDir, { recursive: true });

  const primaryArtifact = ROLE_ARTIFACT_MAP[agent.role] || 'output.md';
  writePrimaryArtifactTemplate(agentDir, primaryArtifact);

  const context = buildContext(
    extraContext
      ? [...ctx.artifactContexts, extraContext]
      : ctx.artifactContexts
  );
  writeTaskMarkdown(agentDir, sessionName, agent.role, ctx.options.task, context);

  const workingDir = resolveWorkingDir(agent, ctx.taskWorktree);
  session.status = 'running';
  session.startedAt = new Date().toISOString();
  session.completedAt = undefined;
  session.error = undefined;
  session.artifactDir = agentDir;
  session.worktreePath = workingDir !== process.cwd() ? workingDir : undefined;
  updateSession(ctx.run.id, session);

  try {
    const result = await ctx.adapter.execute({
      opencodePath: ctx.config.runtime.opencodePath,
      agentName: agent.name,
      sessionId: session.id,
      prompt: agent.prompt,
      task: ctx.options.task,
      primaryArtifact,
      workingDir,
      artifactDir: agentDir,
      timeout: ctx.config.runtime.timeout,
      canModifyCode: agent.canModifyCode,
      context,
    });

    if (!result.success) {
      session.status = 'failed';
      session.error = result.error;
      session.completedAt = new Date().toISOString();
      updateSession(ctx.run.id, session);
      console.log(`  Failed: ${result.error}`);
      return { session, success: false, agentDir };
    }

    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    writeOutputToArtifactIfNeeded(agent, agentDir, result.output);
    const artifactContent = readPrimaryArtifact(agent, agentDir);
    const artifactDecision = evaluateArtifactDecision(agent, agentDir);
    if (!artifactDecision.passed) {
      session.status = 'failed';
      session.error = artifactDecision.reason;
      updateSession(ctx.run.id, session);
      console.log(`  Failed: ${artifactDecision.reason}`);
      console.log('');
      return {
        session,
        success: false,
        artifactContent: artifactContent ?? undefined,
        agentDir,
      };
    }
    if (artifactContent) {
      ctx.artifactContexts.push(`[${sessionName} (${agent.role})]\n${artifactContent}`);
    }
    updateSession(ctx.run.id, session);
    console.log(`  Completed in ${(result.duration / 1000).toFixed(1)}s`);
    console.log('');

    return {
      session,
      success: true,
      artifactContent: artifactContent ?? undefined,
      agentDir,
    };
  } catch (err: any) {
    session.status = 'failed';
    session.error = err.message;
    session.completedAt = new Date().toISOString();
    updateSession(ctx.run.id, session);
    console.log(`  Error: ${err.message}`);
    return { session, success: false, agentDir };
  }
}

function ensureSessionForRun(
  run: Run,
  agent: AgentConfig,
  sessionName: string,
  runDir: string
): Session {
  const existing = run.sessions.find((session) => session.agentName === sessionName);
  if (existing) {
    return existing;
  }

  const session: Session = {
    id: `${sessionName}-${run.id}`,
    agentName: sessionName,
    runId: run.id,
    status: 'pending',
    artifactDir: path.join(runDir, sessionName),
    startedAt: '',
  };
  void agent;
  run.sessions.push(session);
  updateRun(run);
  return session;
}

function buildFailureContext(
  failedAgentName: string,
  agentDir: string,
  error?: string
): string {
  const sections: string[] = [
    `The previous session "${failedAgentName}" failed. Fix the issue in the current worktree and keep prior successful work intact.`,
  ];

  if (error) {
    sections.push(`Failure error:\n${error}`);
  }

  for (const fileName of ['test-report.md', 'review-report.md', 'stdout.log', 'stderr.log']) {
    const filePath = path.join(agentDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      continue;
    }

    sections.push(`${fileName}:\n${content}`);
  }

  return sections.join('\n\n');
}

function evaluateArtifactDecision(
  agent: AgentConfig,
  agentDir: string
): ArtifactDecision {
  if (agent.role === 'tester') {
    return evaluateTesterArtifact(agentDir);
  }

  if (agent.role === 'reviewer') {
    return evaluateReviewerArtifact(agentDir);
  }

  return { passed: true };
}

function evaluateTesterArtifact(agentDir: string): ArtifactDecision {
  const content = readArtifactForDecision(agentDir, 'test-report.md');
  if (!content) {
    return { passed: true };
  }

  if (/^Result:\s*FAIL\s*$/im.test(content)) {
    return {
      passed: false,
      reason: 'Artifact decision failed: test-report.md contains "Result: FAIL"',
    };
  }

  if (/^Result:\s*PASS\s*$/im.test(content)) {
    return { passed: true };
  }

  return { passed: true };
}

function evaluateReviewerArtifact(agentDir: string): ArtifactDecision {
  const content = readArtifactForDecision(agentDir, 'review-report.md');
  if (!content) {
    return { passed: true };
  }

  if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) {
    return {
      passed: false,
      reason: 'Artifact decision failed: review-report.md contains "Decision: CHANGES_REQUESTED"',
    };
  }

  if (/^Decision:\s*APPROVED\s*$/im.test(content)) {
    return { passed: true };
  }

  return { passed: true };
}

function readArtifactForDecision(
  agentDir: string,
  artifactName: string
): string | null {
  const filePath = path.join(agentDir, artifactName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8').trim();
  return content.length > 0 ? content : null;
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
    throw new Error(
      'Cannot create git worktree: the repository has no commits.\n' +
        'Run these commands first:\n' +
        '  git add .\n' +
        '  git commit -m "Initial commit"'
    );
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
  if (taskWorktree && (agent.canModifyCode || agent.role === 'reviewer')) {
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
    const status =
      s.status === 'completed'
        ? 'OK'
        : s.status === 'failed'
          ? 'FAIL'
          : 'PENDING';
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
