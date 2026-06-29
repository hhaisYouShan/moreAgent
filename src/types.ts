export interface AgentConfig {
  name: string;
  role: string;
  description?: string;
  primaryArtifact?: string;
  canModifyCode: boolean;
  branch?: string;
  prompt: string;
  dependsOn?: string[];
}

export interface RuntimeConfig {
  opencodePath: string;
  timeout: number;
  maxRetries: number;
}

export interface ProjectConfig {
  name: string;
  description?: string;
}

export interface MoreAgentConfig {
  version: string;
  project: ProjectConfig;
  agents: AgentConfig[];
  runtime: RuntimeConfig;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Session {
  id: string;
  agentName: string;
  runId: string;
  status: SessionStatus;
  runtimeSessionId?: string;
  worktreePath?: string;
  artifactDir: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface Run {
  id: string;
  task: string;
  status: RunStatus;
  createdAt: string;
  artifactDir: string;
  sessions: Session[];
}

export interface SessionsData {
  runs: Run[];
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export const ARTIFACT_NAMES = [
  'task.md',
  'brain-plan.md',
  'implementation-result.md',
  'test-report.md',
  'review-report.md',
] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];
