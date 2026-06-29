import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readConfig, getMoreAgentDir } from '../config';
import {
  addRun,
  updateRun,
  updateSession,
  markRunningRunsAsStaleFailure,
  readSessions,
} from '../session';
import { writePrimaryArtifactTemplate, writeTaskMarkdown, updateArtifact } from '../artifacts';
import { OpenCodeRuntimeAdapter } from '../runtime/adapter';
import {
  initTmux,
  addAgentWindow,
  type TmuxContext,
} from '../tmux';
import {
  getAgentRuntimeSessionId,
  setAgentRuntimeSessionId,
} from '../runtimeSessions';
import { Run, Session, AgentConfig, WorkflowInfo } from '../types';
import {
  FULL_WORKFLOW_PHASES,
  getPhaseIndex,
  isValidPhase,
} from '../workflow';

export interface StartOptions {
  once: boolean;
  task: string;
  agent?: string;
  loop?: boolean;
  tmux?: boolean;
  resume?: boolean;
  resumeRunId?: string;
  fromPhase?: string;
}

export interface TaskRunResult {
  runId: string;
  status: 'completed' | 'failed';
  artifactDir: string;
  worktreePath: string | null;
}

const MAX_REPAIR_ROUNDS = 2;
const MAX_FULL_REPAIR_ROUNDS = 2;

export async function startCommand(options: StartOptions): Promise<void> {
  if (options.loop) {
    await loopCommand(options.tmux ?? false);
    return;
  }

  if (options.resume) {
    const runId = resolveResumeRunId(options);
    if (!runId) {
      throw new Error('No runs found. Use --run <runId> to resume a specific run.');
    }
    await resumeWorkflow(runId, options);
    return;
  }

  if (options.fromPhase && !isValidPhase(options.fromPhase)) {
    throw new Error(
      `Invalid phase: "${options.fromPhase}". Valid phases: ${FULL_WORKFLOW_PHASES.map((p) => p.id).join(', ')}`
    );
  }

  const result = await runTaskOnce(options);
  console.log(`Run ${result.runId} ${result.status}`);
  console.log(`Artifacts: ${result.artifactDir}`);
  if (result.worktreePath) {
    console.log(`Worktree: ${result.worktreePath}`);
  }
}

async function loopCommand(tmux: boolean): Promise<void> {
  const {
    getNextPendingTask,
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
    hasRunningTasks,
    checkInit,
  } = require('../queue');

  checkInit();
  const config = readConfig();
  assertRuntimeExecutable(config.runtime.opencodePath);

  const runningCount = hasRunningTasks();
  if (runningCount > 0) {
    console.log(
      `\nWarning: ${runningCount} running task(s) from a previous interrupted loop found.`
    );
    console.log('Run: moreagent queue recover\n');
  }

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
      const result = await runTaskOnce({ once: true, task: task.description, tmux });
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

  const agents = options.agent
    ? config.agents.filter((a) => a.name === options.agent)
    : config.agents;

  if (agents.length === 0) {
    throw new Error(`No agent found with name "${options.agent}"`);
  }

  const agentByRole = new Map(agents.map((agent) => [agent.role, agent]));
  const hasFullWorkflow =
    !options.agent &&
    agentByRole.has('brain') &&
    agentByRole.has('product') &&
    agentByRole.has('frontend') &&
    agentByRole.has('backend') &&
    agentByRole.has('tester') &&
    agentByRole.has('reviewer');

  const tmux = options.tmux ? initTmux(runId) : null;

  console.log(`Starting run: ${runId}`);
  console.log(`Task: ${options.task}`);
  console.log(`Agents: ${config.agents.map((a) => a.name).join(', ')}\n`);

  fs.mkdirSync(runDir, { recursive: true });

  const needsWorktree = agents.some((a) => a.canModifyCode);
  const taskWorktree = needsWorktree ? createTaskWorktree(runId) : null;

  const run: Run = {
    id: runId,
    task: options.task,
    status: 'running',
    workflow: hasFullWorkflow
      ? { profile: 'full', completedPhases: [] }
      : undefined,
    createdAt: new Date().toISOString(),
    artifactDir: runDir,
    sessions: [],
  };

  const sessions = agents.map((agent) => createSession(agent, runId, runDir));
  run.sessions = sessions;
  addRun(run);

  const adapter = new OpenCodeRuntimeAdapter();
  const artifactContexts: string[] = [];
  const hasRepairFlow =
    !hasFullWorkflow &&
    !options.agent &&
    agents.some((a) => a.role === 'implementer') &&
    agents.some((a) => a.role === 'tester') &&
    agents.some((a) => a.role === 'reviewer');

  const pipelineSucceeded = hasFullWorkflow
    ? await executePhases({
      config,
      options,
      run,
      runDir,
      taskWorktree,
      agents,
      agentByRole,
      adapter,
      artifactContexts,
      tmux,
      startFrom: options.fromPhase ? getPhaseIndex(options.fromPhase) : 0,
    })
    : hasRepairFlow
      ? await runRepairPipeline({
      config,
      options,
      run,
      runDir,
      taskWorktree,
      agents,
      adapter,
      artifactContexts,
      tmux,
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
      tmux,
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
  tmux: TmuxContext | null;
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

function evaluateGateArtifactFile(agentDir: string, fileName: string): ArtifactDecision {
  const content = readArtifactFromDir(agentDir, fileName);
  if (!content) return { passed: true };
  if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) {
    return { passed: false, reason: `Gate decision: ${fileName} contains "Decision: CHANGES_REQUESTED"` };
  }
  if (/^Decision:\s*APPROVED\s*$/im.test(content)) {
    return { passed: true };
  }
  return { passed: true };
}

function readArtifactFromDir(agentDir: string, fileName: string): string | null {
  const fp = path.join(agentDir, fileName);
  if (!fs.existsSync(fp)) return null;
  const c = fs.readFileSync(fp, 'utf-8').trim();
  return c.length > 0 ? c : null;
}

function resolveResumeRunId(options: StartOptions): string | null {
  if (options.resumeRunId) return options.resumeRunId;
  if (options.resume) {
    const data = readSessions();
    const latest = data.runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return latest?.id ?? null;
  }
  return null;
}

async function resumeWorkflow(runId: string, options: StartOptions): Promise<void> {
  const data = readSessions();
  const run = data.runs.find((r) => r.id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.workflow || run.workflow.profile !== 'full') {
    throw new Error('Resume currently supports full workflow runs only.');
  }
  if (run.status === 'completed') {
    console.log('Run already completed.');
    return;
  }

  const config = readConfig();
  assertRuntimeExecutable(config.runtime.opencodePath);
  const agentByRole = new Map(config.agents.map((a) => [a.role, a]));

  markRunningRunsAsStaleFailure();
  run.status = 'running';
  updateRun(run);

  const tmux = options.tmux ? initTmux(runId) : null;

  const startFrom = run.workflow.completedPhases.length > 0
    ? getPhaseIndex(run.workflow.completedPhases[run.workflow.completedPhases.length - 1]) + 1
    : 0;

  console.log(`Resuming run: ${runId} from phase ${FULL_WORKFLOW_PHASES[startFrom]?.id ?? 'unknown'}`);

  const succeeded = await executePhases({
    config, options, run, runDir: run.artifactDir,
    taskWorktree: run.sessions.find((s) => s.worktreePath)?.worktreePath ?? null,
    agents: config.agents, agentByRole,
    adapter: new OpenCodeRuntimeAdapter(),
    artifactContexts: [],
    tmux, startFrom,
  });

  run.status = succeeded ? 'completed' : 'failed';
  if (run.workflow) run.workflow.currentPhase = undefined;
  updateRun(run);

  console.log(`Run ${runId} ${run.status}`);
  if (!succeeded) {
    console.log('Resume with:');
    console.log(`  moreagent start --resume --run ${runId}`);
    if (run.id === (readSessions().runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.id)) {
      console.log('  moreagent start --resume --latest');
    }
  }
}

async function executePhases(ctx: {
  config: ReturnType<typeof readConfig>;
  options: StartOptions;
  run: Run;
  runDir: string;
  taskWorktree: string | null;
  agents: AgentConfig[];
  agentByRole: Map<string, AgentConfig>;
  adapter: OpenCodeRuntimeAdapter;
  artifactContexts: string[];
  tmux: TmuxContext | null;
  startFrom: number;
}): Promise<boolean> {
  const { run, agentByRole, adapter, tmux, startFrom } = ctx;

  const runner = async (
    agent: AgentConfig,
    sessionName: string,
    artifact: string,
    extraCtx?: string | null,
  ) => {
    let session = run.sessions.find((s) => s.agentName === sessionName);
    if (session && session.status === 'completed') {
      console.log(`  Skipping completed session: ${sessionName}`);
      return { success: true, agentDir: session.artifactDir };
    }
    if (!session) {
      session = ensureSessionForRun(run, agent, sessionName, ctx.runDir);
    }
    return executeAgentSession({
      config: ctx.config, options: ctx.options, run, runDir: ctx.runDir,
      taskWorktree: ctx.taskWorktree, agents: ctx.agents, adapter, tmux,
      artifactContexts: ctx.artifactContexts,
      agent, session, sessionName,
      extraContext: extraCtx ?? '',
      primaryArtifactOverride: artifact,
    });
  };

  const readArtifact = (dir: string, file: string) => readArtifactFromDir(dir, file);

  if (!run.workflow) {
    run.workflow = { profile: 'full', completedPhases: [] };
  }
  const wf = run.workflow;

  for (let pi = startFrom; pi < FULL_WORKFLOW_PHASES.length; pi++) {
    const phase = FULL_WORKFLOW_PHASES[pi];
    wf.currentPhase = phase.id;
    updateRun(run);

    console.log(`\n=== Phase: ${phase.id} (${phase.description}) ===`);

    if (phase.id === 'prd-gate') {
      const gateOk = await runPrdGate(ctx, runner, readArtifact);
      if (!gateOk) { wf.failedPhase = phase.id; updateRun(run); return false; }
    } else if (phase.id === 'tech-gate') {
      const gateOk = await runTechGate(ctx, runner, readArtifact);
      if (!gateOk) { wf.failedPhase = phase.id; updateRun(run); return false; }
    } else if (phase.id === 'test') {
      const testOk = await runTestWithRepair(ctx, runner, readArtifact);
      if (!testOk) { wf.failedPhase = phase.id; updateRun(run); return false; }
    } else if (phase.id === 'review') {
      const reviewOk = await runReviewWithRepair(ctx, runner, readArtifact);
      if (!reviewOk) { wf.failedPhase = phase.id; updateRun(run); return false; }
    } else {
      for (const sess of phase.sessions) {
        const agent = agentByRole.get(sess.agentKey);
        if (!agent) throw new Error(`Agent not found: ${sess.agentKey}`);
        const res = await runner(agent, sess.name, sess.artifact);
        if (!res.success) {
          wf.failedPhase = phase.id;
          updateRun(run);
          return false;
        }
      }
    }

    wf.completedPhases.push(phase.id);
    updateRun(run);
  }

  return true;
}

async function runPrdGate(
  ctx: Parameters<typeof executePhases>[0],
  runner: (agent: AgentConfig, name: string, artifact: string, ctx?: string | null) => Promise<{ success: boolean; agentDir: string }>,
  readArtifact: (dir: string, file: string) => string | null,
): Promise<boolean> {
  const brain = ctx.agentByRole.get('brain')!;
  const product = ctx.agentByRole.get('product')!;
  const maxRounds = 2;

  const productDir = ctx.run.sessions.find((s) => s.agentName === 'product')?.artifactDir ?? '';
  const prdCtx = readArtifact(productDir, 'prd.md');

  const runGateDecision = async (sessionName: string, artifact: string) => {
    const res = await runner(brain, sessionName, artifact);

    if (!res.success) return { passed: false, agentDir: res.agentDir };
    const decision = evaluateGateArtifactFile(res.agentDir, artifact);
    return { passed: decision.passed, agentDir: res.agentDir };
  };

  // Round 1
  const gate1 = await runGateDecision('prd-gate', 'prd-decision.md');
  if (gate1.passed) return true;

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`  PRD gate: revision round ${round}/${maxRounds}`);
    const revArtifact = `prd-revision-${round}.md`;
    const decArtifact = `prd-decision-${round}.md`;

    const revRes = await runner(product, `prd-revision-${round}`, revArtifact, prdCtx);
    if (!revRes.success) return false;

    const gateRes = await runGateDecision(`prd-gate-${round}`, decArtifact);
    if (gateRes.passed) return true;
  }

  console.log('  PRD gate failed after maximum revision rounds.');
  return false;
}

async function runTechGate(
  ctx: Parameters<typeof executePhases>[0],
  runner: (agent: AgentConfig, name: string, artifact: string, ctx?: string | null) => Promise<{ success: boolean; agentDir: string }>,
  readArtifact: (dir: string, file: string) => string | null,
): Promise<boolean> {
  const brain = ctx.agentByRole.get('brain')!;
  const frontend = ctx.agentByRole.get('frontend')!;
  const backend = ctx.agentByRole.get('backend')!;
  const tester = ctx.agentByRole.get('tester')!;
  const maxRounds = 2;

  const buildCtx = () => {
    const fePlan = ctx.run.sessions.find((s) => s.agentName === 'frontend-plan')?.artifactDir ?? '';
    const bePlan = ctx.run.sessions.find((s) => s.agentName === 'backend-plan')?.artifactDir ?? '';
    const tPlan = ctx.run.sessions.find((s) => s.agentName === 'test-plan')?.artifactDir ?? '';
    return [readArtifact(fePlan, 'frontend-plan.md'), readArtifact(bePlan, 'backend-plan.md'), readArtifact(tPlan, 'test-plan.md')]
      .filter(Boolean).join('\n\n---\n\n');
  };

  const runGateDecision = async (sessionName: string, artifact: string) => {
    const res = await runner(brain, sessionName, artifact, buildCtx());
    if (!res.success) return { passed: false, agentDir: res.agentDir };
    const decision = evaluateGateArtifactFile(res.agentDir, artifact);
    return { passed: decision.passed, agentDir: res.agentDir };
  };

  // Round 1
  const gate1 = await runGateDecision('tech-gate', 'tech-review.md');
  if (gate1.passed) return true;

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`  Tech gate: revision round ${round}/${maxRounds}`);
    const revisionCtx = buildCtx();

    const feRes = await runner(frontend, `frontend-plan-revision-${round}`, `frontend-plan-revision-${round}.md`, revisionCtx);
    const beRes = await runner(backend, `backend-plan-revision-${round}`, `backend-plan-revision-${round}.md`, revisionCtx);
    const tRes = await runner(tester, `test-plan-revision-${round}`, `test-plan-revision-${round}.md`, revisionCtx);
    if (!feRes.success || !beRes.success || !tRes.success) return false;

    const gateRes = await runGateDecision(`tech-gate-${round}`, `tech-review-${round}.md`);
    if (gateRes.passed) return true;
  }

  console.log('  Tech gate failed after maximum revision rounds.');
  return false;
}

async function runProductRepairGate(
  runner: GateRunner,
  product: AgentConfig,
  brain: AgentConfig,
  readArtifact: (dir: string, file: string) => string | null,
  round: number,
): Promise<boolean> {
  const maxGateRounds = 2;

  const runDecision = async (name: string, artifact: string) => {
    const res = await runner(brain, name, artifact);
    if (!res.success) return null;
    const content = readArtifact(res.agentDir, artifact);
    if (!content) return 'unknown' as const;
    if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) return 'changes_requested' as const;
    if (/^Decision:\s*APPROVED\s*$/im.test(content)) return 'approved' as const;
    return 'unknown' as const;
  };

  // Initial PRD revision
  const prdRes = await runner(product, `prd-revision-repair-${round}`, `prd-revision-repair-${round}.md`);
  if (!prdRes.success) return false;

  // PRD gate
  const firstDecision = await runDecision(`prd-decision-repair-${round}`, `prd-decision-repair-${round}.md`);
  if (firstDecision === 'approved') return true;
  if (firstDecision === null) return false;

  for (let gr = 1; gr <= maxGateRounds; gr++) {
    await runner(product, `prd-revision-repair-${round}-${gr}`, `prd-revision-repair-${round}-${gr}.md`);
    const decision = await runDecision(`prd-decision-repair-${round}-${gr}`, `prd-decision-repair-${round}-${gr}.md`);
    if (decision === 'approved') return true;
    if (decision === null) return false;
  }
  return false;
}

async function runTechPlanRepairGate(
  runner: GateRunner,
  frontend: AgentConfig,
  backend: AgentConfig,
  tester: AgentConfig,
  brain: AgentConfig,
  readArtifact: (dir: string, file: string) => string | null,
  round: number,
): Promise<boolean> {
  const maxGateRounds = 2;

  const runDecision = async (name: string, artifact: string) => {
    const res = await runner(brain, name, artifact);
    if (!res.success) return null;
    const content = readArtifact(res.agentDir, artifact);
    if (!content) return 'unknown' as const;
    if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) return 'changes_requested' as const;
    if (/^Decision:\s*APPROVED\s*$/im.test(content)) return 'approved' as const;
    return 'unknown' as const;
  };

  // Initial plan revisions
  await runner(frontend, `frontend-plan-revision-repair-${round}`, `frontend-plan-revision-repair-${round}.md`);
  await runner(backend, `backend-plan-revision-repair-${round}`, `backend-plan-revision-repair-${round}.md`);
  await runner(tester, `test-plan-revision-repair-${round}`, `test-plan-revision-repair-${round}.md`);

  // Tech gate
  const firstDecision = await runDecision(`tech-review-repair-${round}`, `tech-review-repair-${round}.md`);
  if (firstDecision === 'approved') return true;
  if (firstDecision === null) return false;

  for (let gr = 1; gr <= maxGateRounds; gr++) {
    await runner(frontend, `frontend-plan-revision-repair-${round}-${gr}`, `frontend-plan-revision-repair-${round}-${gr}.md`);
    await runner(backend, `backend-plan-revision-repair-${round}-${gr}`, `backend-plan-revision-repair-${round}-${gr}.md`);
    await runner(tester, `test-plan-revision-repair-${round}-${gr}`, `test-plan-revision-repair-${round}-${gr}.md`);
    const decision = await runDecision(`tech-review-repair-${round}-${gr}`, `tech-review-repair-${round}-${gr}.md`);
    if (decision === 'approved') return true;
    if (decision === null) return false;
  }
  return false;
}

type GateRunner = (
  agent: AgentConfig,
  name: string,
  artifact: string,
  ctx?: string | null,
) => Promise<{ success: boolean; agentDir: string }>;

async function runTestWithRepair(
  ctx: Parameters<typeof executePhases>[0],
  runner: GateRunner,
  readArtifact: (dir: string, file: string) => string | null,
): Promise<boolean> {
  const tester = ctx.agentByRole.get('tester')!;
  const frontend = ctx.agentByRole.get('frontend')!;
  const backend = ctx.agentByRole.get('backend')!;

  const runTest = async (name: string, artifact: string) => {
    const res = await runner(tester, name, artifact);
    if (!res.success) return { success: false, agentDir: res.agentDir };
    return { success: true, agentDir: res.agentDir };
  };

  // First test run
  const t1 = await runTest('tester', 'test-report.md');
  if (t1.success) {
    const decision = evaluateArtifactDecisionForFile(t1.agentDir, 'test-report.md');
    if (decision.passed) return true;
  } else {
    return false;
  }

  // Repair loop
// Test repair loop
    for (let round = 1; round <= MAX_FULL_REPAIR_ROUNDS; round++) {
      const failureRes = await runFailureAnalysis(ctx, runner, 'test', round, readArtifact);
      if (!failureRes.owner || failureRes.owner === 'unknown') {
        console.log('  Failure analysis: owner unknown — stopping.');
        return false;
      }

      const owner = failureRes.owner;
      console.log(`  Test repair round ${round}: owner=${owner}`);

      if (owner === 'frontend') {
        await runner(frontend, `frontend-repair-${round}`, `frontend-repair-${round}.md`);
      } else if (owner === 'backend') {
        await runner(backend, `backend-repair-${round}`, `backend-repair-${round}.md`);
      } else if (owner === 'tester') {
        await runner(tester, `test-repair-${round}`, `test-repair-${round}.md`);
      } else if (owner === 'tech-plan') {
        const brain = ctx.agentByRole.get('brain')!;
        const gateOk = await runTechPlanRepairGate(runner, frontend, backend, tester, brain, readArtifact, round);
        if (!gateOk) return false;
        await runner(frontend, `frontend-implementation-repair-${round}`, `frontend-implementation-repair-${round}.md`);
        await runner(backend, `backend-implementation-repair-${round}`, `backend-implementation-repair-${round}.md`);
      } else if (owner === 'product') {
        const product = ctx.agentByRole.get('product')!;
        const brain = ctx.agentByRole.get('brain')!;
        const gateOk = await runProductRepairGate(runner, product, brain, readArtifact, round);
        if (!gateOk) return false;
        await runner(frontend, `frontend-plan-repair-${round}`, `frontend-plan-repair-${round}.md`);
        await runner(backend, `backend-plan-repair-${round}`, `backend-plan-repair-${round}.md`);
        await runner(tester, `test-plan-repair-${round}`, `test-plan-repair-${round}.md`);
        await runner(frontend, `frontend-implementation-repair-${round}`, `frontend-implementation-repair-${round}.md`);
        await runner(backend, `backend-implementation-repair-${round}`, `backend-implementation-repair-${round}.md`);
      }

      const retry = await runTest(`test-retry-${round}`, `test-report-retry-${round}.md`);
    if (retry.success) {
      const d = evaluateArtifactDecisionForFile(retry.agentDir, `test-report-retry-${round}.md`);
      if (d.passed) return true;
    }
  }

  return false;
}

async function runReviewWithRepair(
  ctx: Parameters<typeof executePhases>[0],
  runner: GateRunner,
  readArtifact: (dir: string, file: string) => string | null,
): Promise<boolean> {
  const reviewer = ctx.agentByRole.get('reviewer')!;
  const tester = ctx.agentByRole.get('tester')!;
  const frontend = ctx.agentByRole.get('frontend')!;
  const backend = ctx.agentByRole.get('backend')!;

  const runReview = async (name: string, artifact: string) => {
    const res = await runner(reviewer, name, artifact);
    if (!res.success) return { success: false, agentDir: res.agentDir };
    return { success: true, agentDir: res.agentDir };
  };

  const runTest = async (name: string, artifact: string) => {
    const res = await runner(tester, name, artifact);
    if (!res.success) return { success: false, agentDir: res.agentDir };
    return { success: true, agentDir: res.agentDir };
  };

  // First review
  const r1 = await runReview('reviewer', 'review-report.md');
  if (r1.success) {
    const d = evaluateArtifactDecisionForFile(r1.agentDir, 'review-report.md');
    if (d.passed) return true;
  } else {
    return false;
  }

  // Repair loop
  for (let round = 1; round <= MAX_FULL_REPAIR_ROUNDS; round++) {
    const failureRes = await runFailureAnalysis(ctx, runner, 'review', round, readArtifact);
    if (!failureRes.owner || failureRes.owner === 'unknown') {
      console.log('  Failure analysis: owner unknown — stopping.');
      return false;
    }

    const owner = failureRes.owner;
    console.log(`  Review repair round ${round}: owner=${owner}`);

    if (owner === 'frontend') {
      await runner(frontend, `frontend-repair-${round}`, `frontend-repair-${round}.md`);
    } else if (owner === 'backend') {
      await runner(backend, `backend-repair-${round}`, `backend-repair-${round}.md`);
    } else if (owner === 'tester') {
      await runner(tester, `test-repair-${round}`, `test-repair-${round}.md`);
    } else if (owner === 'tech-plan') {
      const brain = ctx.agentByRole.get('brain')!;
      const gateOk = await runTechPlanRepairGate(runner, frontend, backend, tester, brain, readArtifact, round);
      if (!gateOk) return false;
      await runner(frontend, `frontend-implementation-repair-${round}`, `frontend-implementation-repair-${round}.md`);
      await runner(backend, `backend-implementation-repair-${round}`, `backend-implementation-repair-${round}.md`);
    } else if (owner === 'product') {
      const product = ctx.agentByRole.get('product')!;
      const brain = ctx.agentByRole.get('brain')!;
      const gateOk = await runProductRepairGate(runner, product, brain, readArtifact, round);
      if (!gateOk) return false;
      await runner(frontend, `frontend-plan-repair-${round}`, `frontend-plan-repair-${round}.md`);
      await runner(backend, `backend-plan-repair-${round}`, `backend-plan-repair-${round}.md`);
      await runner(tester, `test-plan-repair-${round}`, `test-plan-repair-${round}.md`);
      await runner(frontend, `frontend-implementation-repair-${round}`, `frontend-implementation-repair-${round}.md`);
      await runner(backend, `backend-implementation-repair-${round}`, `backend-implementation-repair-${round}.md`);
    }

    // Re-test, then re-review
    const tRetry = await runTest(`test-retry-${round}`, `test-report-retry-${round}.md`);
    if (!tRetry.success) continue;

    const rRetry = await runReview(`review-retry-${round}`, `review-report-retry-${round}.md`);
    if (rRetry.success) {
      const d = evaluateArtifactDecisionForFile(rRetry.agentDir, `review-report-retry-${round}.md`);
      if (d.passed) return true;
    }
  }

  return false;
}

async function runFailureAnalysis(
  ctx: Parameters<typeof executePhases>[0],
  runner: GateRunner,
  trigger: 'test' | 'review',
  round: number,
  readArtifact: (dir: string, file: string) => string | null,
): Promise<{ owner: string | null }> {
  const brain = ctx.agentByRole.get('brain')!;
  const frontend = ctx.agentByRole.get('frontend')!;
  const backend = ctx.agentByRole.get('backend')!;
  const tester = ctx.agentByRole.get('tester')!;

  const testDir = ctx.run.sessions.find((s) => s.agentName === 'tester')?.artifactDir ?? '';
  const reviewDir = ctx.run.sessions.find((s) => s.agentName === 'reviewer')?.artifactDir ?? '';
  const feImplDir = ctx.run.sessions.find((s) => s.agentName === 'frontend-implementation')?.artifactDir ?? '';
  const beImplDir = ctx.run.sessions.find((s) => s.agentName === 'backend-implementation')?.artifactDir ?? '';

  const context = [
    `Task: ${ctx.options.task}`,
    trigger === 'test'
      ? readArtifact(testDir, 'test-report.md')
      : readArtifact(reviewDir, 'review-report.md'),
    readArtifact(feImplDir, 'frontend-implementation.md'),
    readArtifact(beImplDir, 'backend-implementation.md'),
  ].filter(Boolean).join('\n\n---\n\n');

  const promptCtx = context + `\n\n## Owner Assignment Rules\nYou MUST write exactly ONE Owner line at the top of your output:\nOwner: frontend\nOwner: backend\nOwner: tester\nOwner: product\nOwner: tech-plan\nOwner: unknown\n\nRules:\n- If the test-report/review-report clearly points to frontend code, choose Owner: frontend\n- If it clearly points to backend code, choose Owner: backend\n- If the test cases or test assertions are wrong, choose Owner: tester\n- If the PRD is unclear or contradictory, choose Owner: product\n- If the technical architecture plan is flawed, choose Owner: tech-plan\n- If the evidence is insufficient or unclear, choose Owner: unknown\n- Do NOT keep the default value. Make an intentional choice based on evidence.`;

  const sessionName = `failure-analysis-${trigger}-${round}`;
  const res = await runner(brain, sessionName, 'failure-analysis.md', promptCtx);
  if (!res.success) return { owner: null };

  const content = readArtifact(res.agentDir, 'failure-analysis.md');
  if (!content) return { owner: null };

  const match = content.match(/^Owner:\s*(\S+)/m);
  if (!match) return { owner: null };

  const valid = ['frontend', 'backend', 'tester', 'product', 'tech-plan', 'unknown'];
  return { owner: valid.includes(match[1]) ? match[1] : null };
}

function evaluateArtifactDecisionForFile(agentDir: string, fileName: string): ArtifactDecision {
  if (fileName.includes('test-report')) {
    const content = readArtifactFromDir(agentDir, fileName);
    if (!content) return { passed: true };
    if (/^Result:\s*FAIL\s*$/im.test(content)) {
      return { passed: false, reason: `Artifact decision: ${fileName} contains "Result: FAIL"` };
    }
    if (/^Result:\s*PASS\s*$/im.test(content)) {
      return { passed: true };
    }
    return { passed: true };
  }
  if (fileName.includes('review-report')) {
    const content = readArtifactFromDir(agentDir, fileName);
    if (!content) return { passed: true };
    if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) {
      return { passed: false, reason: `Artifact decision: ${fileName} contains "Decision: CHANGES_REQUESTED"` };
    }
    if (/^Decision:\s*APPROVED\s*$/im.test(content)) {
      return { passed: true };
    }
    return { passed: true };
  }
  return { passed: true };
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
    primaryArtifactOverride?: string;
  }
): Promise<AgentRunResult> {
  const { agent, session, sessionName, extraContext, primaryArtifactOverride } = ctx;

  console.log(`--- Agent: ${sessionName} (${agent.role}) ---`);

  const agentDir = path.join(ctx.runDir, sessionName);
  fs.mkdirSync(agentDir, { recursive: true });

  const primaryArtifact = primaryArtifactOverride ?? getPrimaryArtifact(agent);
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

  if (ctx.tmux) {
    const stdoutPath = path.join(agentDir, 'stdout.log');
    const stderrPath = path.join(agentDir, 'stderr.log');
    addAgentWindow(ctx.tmux, sessionName, stdoutPath, stderrPath);
  }

  try {
    if (!session.runtimeSessionId) {
      if (sessionName.startsWith('repair-')) {
        const baseRole = sessionName.replace(/^repair-\d+-/, '');
        const baseSession = ctx.run.sessions.find(
          (s) => s.agentName === baseRole && s.runtimeSessionId
        );
        if (baseSession?.runtimeSessionId) {
          session.runtimeSessionId = baseSession.runtimeSessionId;
        }
      }
      if (!session.runtimeSessionId) {
        const stored = getAgentRuntimeSessionId(agent.name);
        if (stored) {
          session.runtimeSessionId = stored;
        }
      }
      if (session.runtimeSessionId) {
        updateSession(ctx.run.id, session);
      }
    }

    const result = await ctx.adapter.execute({
      opencodePath: ctx.config.runtime.opencodePath,
      agentName: agent.name,
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
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

    if (!session.runtimeSessionId) {
      const captured = ctx.adapter.captureRuntimeSessionId(
        ctx.config.runtime.opencodePath,
        session.id
      );
      if (captured) {
        session.runtimeSessionId = captured;
        if (!sessionName.startsWith('repair-')) {
          setAgentRuntimeSessionId(agent.name, captured);
        }
        updateSession(ctx.run.id, session);
      }
    }

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

  if (agent.role === 'brain') {
    return evaluateGateArtifact(agentDir);
  }

  return { passed: true };
}

function evaluateGateArtifact(agentDir: string): ArtifactDecision {
  const decisionFiles = ['prd-decision.md', 'tech-review.md'];
  for (const file of decisionFiles) {
    const content = readArtifactForDecision(agentDir, file);
    if (!content) {
      continue;
    }
    if (/^Decision:\s*CHANGES_REQUESTED\s*$/im.test(content)) {
      return {
        passed: false,
        reason: `Artifact decision failed: ${file} contains "Decision: CHANGES_REQUESTED"`,
      };
    }
    if (/^Decision:\s*APPROVED\s*$/im.test(content)) {
      return { passed: true };
    }
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

function getPrimaryArtifact(agent: AgentConfig): string {
  if (agent.primaryArtifact) {
    return agent.primaryArtifact;
  }
  return ROLE_ARTIFACT_MAP[agent.role] || 'output.md';
}

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
  const artifactName = getPrimaryArtifact(agent);

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
  const artifactName = getPrimaryArtifact(agent);

  const filePath = path.join(agentDir, artifactName);
  if (!isArtifactStillTemplate(filePath)) {
    return;
  }

  const title = artifactName
    .replace('.md', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const content = `# ${title}

## Agent: ${agent.name} (${agent.role})

## Output

${stdout}
`;
  updateArtifact(agentDir, artifactName, content);
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
