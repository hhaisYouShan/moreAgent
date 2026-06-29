export interface WorkflowPhase {
  id: string;
  sessions: {
    name: string;
    agentKey: string;
    artifact: string;
    needsGateDecision?: boolean;
  }[];
  description: string;
}

export const FULL_WORKFLOW_PHASES: WorkflowPhase[] = [
  {
    id: 'brain',
    description: 'Task analysis',
    sessions: [{ name: 'brain', agentKey: 'brain', artifact: 'brain-plan.md' }],
  },
  {
    id: 'prd',
    description: 'Product PRD',
    sessions: [{ name: 'product', agentKey: 'product', artifact: 'prd.md' }],
  },
  {
    id: 'prd-review',
    description: 'PRD review meeting',
    sessions: [
      { name: 'frontend-prd-review', agentKey: 'frontend', artifact: 'frontend-prd-review.md' },
      { name: 'backend-prd-review', agentKey: 'backend', artifact: 'backend-prd-review.md' },
      { name: 'test-prd-review', agentKey: 'tester', artifact: 'test-prd-review.md' },
    ],
  },
  {
    id: 'prd-gate',
    description: 'PRD gate (up to 2 revision rounds)',
    sessions: [{ name: 'prd-gate-1', agentKey: 'brain', artifact: 'prd-decision.md', needsGateDecision: true }],
  },
  {
    id: 'tech-plan',
    description: 'Technical plans',
    sessions: [
      { name: 'frontend-plan', agentKey: 'frontend', artifact: 'frontend-plan.md' },
      { name: 'backend-plan', agentKey: 'backend', artifact: 'backend-plan.md' },
      { name: 'test-plan', agentKey: 'tester', artifact: 'test-plan.md' },
    ],
  },
  {
    id: 'tech-gate',
    description: 'Technical gate',
    sessions: [{ name: 'tech-gate-1', agentKey: 'brain', artifact: 'tech-review.md', needsGateDecision: true }],
  },
  {
    id: 'implementation',
    description: 'Implementation',
    sessions: [
      { name: 'frontend-implementation', agentKey: 'frontend', artifact: 'frontend-implementation.md' },
      { name: 'backend-implementation', agentKey: 'backend', artifact: 'backend-implementation.md' },
    ],
  },
  {
    id: 'test',
    description: 'Testing',
    sessions: [{ name: 'tester', agentKey: 'tester', artifact: 'test-report.md' }],
  },
  {
    id: 'review',
    description: 'Code review',
    sessions: [{ name: 'reviewer', agentKey: 'reviewer', artifact: 'review-report.md' }],
  },
];

export const ALL_PHASE_IDS = FULL_WORKFLOW_PHASES.map((p) => p.id);

export function isValidPhase(phase: string): boolean {
  return ALL_PHASE_IDS.includes(phase);
}

export function getPhaseIndex(phase: string): number {
  return ALL_PHASE_IDS.indexOf(phase);
}
