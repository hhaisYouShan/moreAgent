const AGENT_META = {
  brain_agent: ['brain-check', 'scripts/agent-loop/agents/brain-agent.md'],
  product_agent: ['product-agent', 'scripts/agent-loop/agents/product-agent.md'],
  ui_agent: ['ui-agent', 'scripts/agent-loop/agents/ui-agent.md'],
  frontend_architect_agent: ['frontend-architect', 'scripts/agent-loop/agents/frontend-architect-agent.md'],
  backend_architect_agent: ['backend-architect', 'scripts/agent-loop/agents/backend-architect-agent.md'],
  frontend_agent: ['frontend-agent', 'scripts/agent-loop/agents/frontend-agent.md'],
  backend_agent: ['backend-agent', 'scripts/agent-loop/agents/backend-agent.md'],
  test_agent: ['test-agent', 'scripts/agent-loop/agents/test-agent.md'],
  review_agent: ['review-agent', 'scripts/agent-loop/agents/review-agent.md'],
  repair_agent: ['repair-agent', 'scripts/agent-loop/agents/repair-agent.md'],
};

const AGENT_LABELS = {
  brain_agent: 'Brain Agent',
  product_agent: 'Product Agent',
  ui_agent: 'UI Agent',
  frontend_architect_agent: 'Frontend Architect',
  backend_architect_agent: 'Backend Architect',
  frontend_agent: 'Frontend Agent',
  backend_agent: 'Backend Agent',
  test_agent: 'Test Agent',
  review_agent: 'Review Agent',
  repair_agent: 'Repair Agent',
};

const TASK_LABELS = {
  'product-review': ['产品初审', '检查 PRD 是否完整、可开发、可测试，并修订或提出修订建议'],
  'frontend-prd-review': ['前端 PRD 评审', '评审页面拆分、状态、接口、组件和前端风险'],
  'backend-prd-review': ['后端 PRD 评审', '评审领域模型、数据库、接口、状态机、幂等和异常处理'],
  'test-prd-review': ['测试 PRD 评审', '评审验收标准、测试场景、异常用例和可测性'],
  'ui-prd-review': ['UI PRD 评审', '评审页面结构、交互路径、视觉规范和文案体验'],
  'frontend-architecture-design': ['前端架构设计', '设计路由、组件、状态、接口、权限、性能和工程规范'],
  'backend-architecture-design': ['后端架构设计', '设计领域模型、数据库、接口、幂等、异常和并发策略'],
  'frontend-architecture-acceptance': ['前端架构验收', '验收前端架构是否能支撑 PRD 和后续开发'],
  'backend-architecture-acceptance': ['后端架构验收', '验收后端架构是否能支撑 PRD 和后续开发'],
  'architecture-testability-review': ['架构可测性评审', '评审架构方案是否可测试、可回归、可验收'],
  'frontend-architecture-impact-review': ['前端架构影响评审', '评估现有页面、路由、组件、状态、接口、权限、缓存和不可改边界'],
  'backend-architecture-impact-review': ['后端架构影响评审', '评估现有模块、API、DTO、DB、权限、任务、AI 调用、迁移和回滚风险'],
  'architecture-impact-testability-review': ['架构影响可测性评审', '评估架构影响是否可测试、风险是否可回归、验收路径是否可执行'],
  'ui-design': ['UI 设计', '输出页面结构、视觉规范、组件规则和交互约束'],
  'frontend-dev-design': ['前端开发方案', '输出前端开发设计、接口对接方案和原子任务'],
  'backend-dev-design': ['后端开发方案', '输出后端开发设计、数据库/接口方案和原子任务'],
  'test-design': ['测试方案', '输出测试用例、测试数据、异常场景和验收路径'],
  'product-design-review': ['产品方案评审', '只检查 PRD 覆盖、产品目标、验收条件和需求偏差'],
  'ui-design-review': ['UI 方案评审', '只检查视觉、交互、页面状态和 UI 设计落地一致性'],
  'test-design-review': ['测试方案评审', '只检查可测性、测试覆盖、测试数据、预期结果和回归范围'],
  'frontend-design-review': ['前端方案评审', '只检查前端架构、路由、组件边界、状态管理和前端原子任务可执行性'],
  'backend-design-review': ['后端方案评审', '只检查后端架构、接口契约、数据模型、权限、幂等、迁移和后端原子任务'],
  'atomic-task-review': ['原子任务评审', '只检查跨文档一致性、遗漏、原子任务质量和综合风险'],
  'frontend-atomic-implementation': ['前端实现', '按原子任务开发前端页面、组件、状态和接口对接'],
  'backend-atomic-implementation': ['后端实现', '按原子任务开发数据库、接口、业务逻辑和任务流程'],
  'test-execution': ['测试执行', '执行测试用例、必要时仅在授权范围内新增/修改测试代码，并输出缺陷报告'],
  'product-acceptance': ['产品验收', '按 PRD 逐条验收功能、流程、体验、测试报告和遗留问题'],
  'user-acceptance': ['用户验收准备', '整理用户验收清单、待确认问题和用户确认记录，不代替用户确认'],
  archive: ['项目归档', '归档 PRD、设计、测试、验收和流程产物'],
  'blocked-question': ['阻塞问题整理', '整理必须由用户决策的问题，停止自动推进'],
};

const CODE_AGENTS = new Set(['frontend_agent', 'backend_agent', 'repair_agent']);
const TEST_ALLOWED_CHANGE_PATTERNS = [
  'client/**/*.test.*',
  'client/**/*.spec.*',
  'server/**/*.test.*',
  'server/**/*.spec.*',
  'tests/**',
  'e2e/**',
  'playwright.config.*',
  'vitest.config.*',
  'jest.config.*',
];
const LOOP_DOCS_ROOT = 'agent-loop-docs';
const REQUIRED_CONTEXT_FILES = [
  'agent-loop-docs/process/workflow-state.json',
  'agent-loop-docs/process/round-context.json',
  'agent-loop-docs/process/workflow-state.md',
  'agent-loop-docs/process/confirmed-decisions.json',
  'agent-loop-docs/process/agent-loop-dashboard.md',
  'agent-loop-docs/process/completion-status.md',
];

export function planTasks(state, options = {}) {
  const forcedPhase = options.phase;
  const phase = normalizePhase(forcedPhase || state.phase);
  const round = Number(options.round || state.round || 0) + 1;
  const featureKey = state.featureKey || 'bossresume-full-refactor';
  const gateStatus = forcedPhase ? 'DRAFT' : normalizeGateStatus(state.gateStatus);

  if (gateStatus === 'CHANGES_REQUESTED') return issueRepairTasks(featureKey, phase, round, state);
  if (gateStatus === 'RECHECK_REQUIRED') return recheckTasks(featureKey, phase, round, state);
  if (gateStatus === 'BLOCKED') return [blockedQuestionTask(featureKey, phase, round, state)];

  switch (phase) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW': return [productReviewTask(featureKey, round, state)];
    case 'PRD_REVIEW': return prdReviewTasks(featureKey, round, state);
    case 'ARCHITECTURE_DESIGN': return architectureDesignTasks(featureKey, round, state);
    case 'ARCHITECTURE_REVIEW': return architectureReviewTasks(featureKey, round, state);
    case 'ARCHITECTURE_IMPACT_REVIEW': return architectureImpactReviewTasks(featureKey, round, state);
    case 'UI_DESIGN': return uiDesignTasks(featureKey, round, state);
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN': return developmentDesignTasks(featureKey, round, state);
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return designReviewTasks(featureKey, round, state);
    case 'IMPLEMENTATION': return implementationTasks(featureKey, round, state);
    case 'TESTING': return testingTasks(featureKey, round, state);
    case 'REPAIR': return repairTasks(featureKey, round, state);
    case 'PRODUCT_ACCEPTANCE': return productAcceptanceTasks(featureKey, round, state);
    case 'USER_ACCEPTANCE': return userAcceptanceTasks(featureKey, round, state);
    case 'ARCHIVE': return archiveTasks(featureKey, round, state);
    default: return [brainCheckTask(featureKey, phase, round, state)];
  }
}

function productReviewTask(featureKey, round, state) {
  return createTask({ featureKey, phase: 'PRODUCT_REVIEW', round, agent: 'product_agent', slug: 'product-review', title: 'Product Agent PRD first review and revision', outputFiles: [loopDoc('reviews', `${featureKey}-product-review-round-${round}.md`)], editableFiles: productEditableFiles(state), state });
}

function prdReviewTasks(featureKey, round, state) {
  return [
    ['frontend_agent', 'frontend-prd-review', loopDoc('reviews', `${featureKey}-frontend-prd-review-round-${round}.md`)],
    ['backend_agent', 'backend-prd-review', loopDoc('reviews', `${featureKey}-backend-prd-review-round-${round}.md`)],
    ['test_agent', 'test-prd-review', loopDoc('reviews', `${featureKey}-test-prd-review-round-${round}.md`)],
    ['ui_agent', 'ui-prd-review', loopDoc('reviews', `${featureKey}-ui-prd-review-round-${round}.md`)],
  ].map(([agent, slug, outputFile]) => createTask({ featureKey, phase: 'PRD_REVIEW', round, agent, slug, title: `${agent} PRD review`, outputFiles: [outputFile], allowCodeChanges: false, state }));
}

function architectureDesignTasks(featureKey, round, state) {
  return [
    ['frontend_architect_agent', 'frontend-architecture-design', 'Frontend architecture design', loopDoc('tech', `${featureKey}-frontend-architecture-design-v${round}.md`)],
    ['backend_architect_agent', 'backend-architecture-design', 'Backend architecture design', loopDoc('tech', `${featureKey}-backend-architecture-design-v${round}.md`)],
  ].map(([agent, slug, title, outputFile]) => createTask({ featureKey, phase: 'ARCHITECTURE_DESIGN', round, agent, slug, title, outputFiles: [outputFile], allowCodeChanges: false, state }));
}

function architectureReviewTasks(featureKey, round, state) {
  return [
    ['frontend_architect_agent', 'frontend-architecture-acceptance', loopDoc('reviews', `${featureKey}-frontend-architecture-acceptance-round-${round}.md`)],
    ['backend_architect_agent', 'backend-architecture-acceptance', loopDoc('reviews', `${featureKey}-backend-architecture-acceptance-round-${round}.md`)],
    ['test_agent', 'architecture-testability-review', loopDoc('reviews', `${featureKey}-architecture-testability-review-round-${round}.md`)],
  ].map(([agent, slug, outputFile]) => createTask({ featureKey, phase: 'ARCHITECTURE_REVIEW', round, agent, slug, title: `${agent} architecture acceptance`, outputFiles: [outputFile], allowCodeChanges: false, state }));
}

function architectureImpactReviewTasks(featureKey, round, state) {
  return [
    ['frontend_architect_agent', 'frontend-architecture-impact-review', 'Frontend architecture impact review', loopDoc('reviews', `${featureKey}-frontend-architecture-impact-review-round-${round}.md`)],
    ['backend_architect_agent', 'backend-architecture-impact-review', 'Backend architecture impact review', loopDoc('reviews', `${featureKey}-backend-architecture-impact-review-round-${round}.md`)],
    ['test_agent', 'architecture-impact-testability-review', 'Architecture impact testability review', loopDoc('reviews', `${featureKey}-architecture-impact-testability-review-round-${round}.md`)],
  ].map(([agent, slug, title, outputFile]) => createTask({ featureKey, phase: 'ARCHITECTURE_IMPACT_REVIEW', round, agent, slug, title, outputFiles: [outputFile], allowCodeChanges: false, state }));
}

function uiDesignTasks(featureKey, round, state) {
  return [createTask({ featureKey, phase: 'UI_DESIGN', round, agent: 'ui_agent', slug: 'ui-design', title: 'UI page structure and visual specification', outputFiles: [loopDoc('tech', `${featureKey}-ui-design-spec-v${round}.md`)], state })];
}

function developmentDesignTasks(featureKey, round, state) {
  return [
    ['frontend_agent', 'frontend-dev-design', 'Frontend development design with atomic tasks', loopDoc('tech', `${featureKey}-frontend-dev-plan-v${round}.md`)],
    ['backend_agent', 'backend-dev-design', 'Backend development design with atomic tasks', loopDoc('tech', `${featureKey}-backend-dev-plan-v${round}.md`)],
    ['test_agent', 'test-design', 'Test design and test cases', loopDoc('tech', `${featureKey}-test-plan-v${round}.md`)],
  ].map(([agent, slug, title, outputFile]) => createTask({ featureKey, phase: 'DEVELOPMENT_DESIGN', round, agent, slug, title, outputFiles: [outputFile], allowCodeChanges: false, state }));
}

function designReviewTasks(featureKey, round, state) {
  const tasks = [
    { agent: 'product_agent', slug: 'product-design-review', outputFile: loopDoc('reviews', `${featureKey}-product-design-review-round-${round}.md`), title: 'Product design review for PRD coverage and acceptance conditions', responsibility: '只检查 PRD 覆盖、产品目标、验收条件、需求偏差和范围漂移；不审查 UI、架构或测试实现细节。' },
    { agent: 'ui_agent', slug: 'ui-design-review', outputFile: loopDoc('reviews', `${featureKey}-ui-design-review-round-${round}.md`), title: 'UI design review for visual interaction and page states', responsibility: '只检查视觉规范、交互流程、页面状态、字段优先级和 UI 设计落地一致性。' },
    { agent: 'test_agent', slug: 'test-design-review', outputFile: loopDoc('reviews', `${featureKey}-test-design-review-round-${round}.md`), title: 'Test design review for coverage and expected results', responsibility: '只检查可测性、测试覆盖、测试数据、预期结果、异常路径和回归范围。' },
    { agent: 'frontend_architect_agent', slug: 'frontend-design-review', outputFile: loopDoc('reviews', `${featureKey}-frontend-design-review-round-${round}.md`), title: 'Frontend architecture design review', responsibility: '只检查前端架构、路由、组件边界、状态管理、接口接入和前端原子任务可执行性。' },
    { agent: 'backend_architect_agent', slug: 'backend-design-review', outputFile: loopDoc('reviews', `${featureKey}-backend-design-review-round-${round}.md`), title: 'Backend architecture design review', responsibility: '只检查后端架构、接口契约、数据模型、权限、幂等、迁移风险和后端原子任务可执行性。' },
    { agent: 'review_agent', slug: 'atomic-task-review', outputFile: loopDoc('reviews', `${featureKey}-atomic-task-review-round-${round}.md`), title: 'Cross-document consistency and atomic task review', responsibility: '只检查跨文档一致性、遗漏、原子任务质量、超范围实现风险和综合进入实现风险。' },
  ];

  return tasks.map((task) => createTask({ featureKey, phase: 'DESIGN_REVIEW', round, agent: task.agent, slug: task.slug, title: task.title, responsibility: task.responsibility, outputFiles: [task.outputFile], allowCodeChanges: false, state }));
}

function implementationTasks(featureKey, round, state) {
  return [
    ['frontend_agent', 'frontend-atomic-implementation', loopDoc('test-reports', `${featureKey}-frontend-atomic-implementation-round-${round}.md`)],
    ['backend_agent', 'backend-atomic-implementation', loopDoc('test-reports', `${featureKey}-backend-atomic-implementation-round-${round}.md`)],
  ].map(([agent, slug, outputFile]) => createTask({ featureKey, phase: 'IMPLEMENTATION', round, agent, slug, title: `${agent} atomic implementation`, outputFiles: [outputFile], allowCodeChanges: true, state }));
}

function testingTasks(featureKey, round, state) {
  return [createTask({ featureKey, phase: 'TESTING', round, agent: 'test_agent', slug: 'test-execution', title: 'Test execution and defect report to Brain Agent', outputFiles: [loopDoc('test-reports', `${featureKey}-test-execution-round-${round}.md`)], allowCodeChanges: true, allowedChangePatterns: TEST_ALLOWED_CHANGE_PATTERNS, responsibility: '执行现有测试、浏览器/接口/手工验证；如需新增或修改测试代码，只能改 allowedChangePatterns 列出的测试文件，禁止修改业务实现。', state })];
}

function repairTasks(featureKey, round, state) {
  return issueRepairTasks(featureKey, 'REPAIR', round, state);
}

function productAcceptanceTasks(featureKey, round, state) {
  return [createTask({ featureKey, phase: 'PRODUCT_ACCEPTANCE', round, agent: 'product_agent', slug: 'product-acceptance', title: 'Product acceptance against PRD and test report', outputFiles: [loopDoc('acceptance', `${featureKey}-product-acceptance-v${round}.md`)], inputSearchPatterns: productAcceptanceInputSearchPatterns(featureKey), responsibility: '按 PRD 逐条对照验收，必须读取 inputSearchPatterns 指向的最新测试报告、实现报告、Gate 决策和未关闭 Issue，列出需求偏差、体验问题、遗留问题，并判断是否允许进入用户验收。', state })];
}

function userAcceptanceTasks(featureKey, round, state) {
  return [createTask({ featureKey, phase: 'USER_ACCEPTANCE', round, agent: 'brain_agent', slug: 'user-acceptance', title: 'Prepare user acceptance checklist and require explicit user confirmation', outputFiles: [loopDoc('acceptance', `${featureKey}-user-acceptance-v${round}.md`)], responsibility: '整理用户验收清单和待确认问题；没有用户明确确认时，gate_result.json 必须 BLOCKED/HUMAN_DECISION_REQUIRED，不得进入归档。', state })];
}

function archiveTasks(featureKey, round, state) {
  return [createTask({ featureKey, phase: 'ARCHIVE', round, agent: 'brain_agent', slug: 'archive', title: 'Archive accepted workflow documents', outputFiles: [loopDoc('archive', `${featureKey}-archive-report-round-${round}.md`)], state })];
}

function issueRepairTasks(featureKey, phase, round, state) {
  const agents = parseAgentList(state.nextAgent || state.ownerAgents || repairAgentsForPhase(phase));
  return agents.map((agent) => createTask({ featureKey, phase, round, agent, slug: `${agentSlug(agent)}-issue-fix`, title: `${agent} fixes assigned gate issues`, outputFiles: [repairOutputForAgent(featureKey, agent, round)], editableFiles: editableFilesForIssueAgent(agent, state), allowedChangePatterns: allowedChangePatternsForIssueAgent(agent), allowCodeChanges: allowCodeChangesForIssueAgent(agent), state }));
}

function recheckTasks(featureKey, phase, round, state) {
  const agents = parseAgentList(recheckAgentsForPhase(phase));
  return agents.map((agent) => createTask({ featureKey, phase, round, agent, slug: `${agentSlug(agent)}-recheck`, title: `${agent} rechecks completed fixes before Gate advances`, outputFiles: [loopDoc('reviews', `${featureKey}-${agentSlug(agent)}-recheck-round-${round}.md`)], allowCodeChanges: false, state }));
}

function blockedQuestionTask(featureKey, phase, round, state) {
  return createTask({ featureKey, phase, round, agent: 'brain_agent', slug: 'blocked-question', title: 'Summarize blocked questions for user decision', outputFiles: [loopDoc('issues', `${featureKey}-blocked-questions-round-${round}.md`)], state });
}

function brainCheckTask(featureKey, phase, round, state) {
  return createTask({ featureKey, phase, round, agent: 'brain_agent', slug: `${phase.toLowerCase()}-brain-check`, title: `Brain check for ${phase}`, outputFiles: [loopDoc('decisions', `${featureKey}-${phase.toLowerCase()}-brain-check-round-${round}.md`)], state });
}

function createTask({ featureKey, phase, round, agent, slug, title, outputFiles, allowCodeChanges = false, inputFiles = [], inputSearchPatterns = [], editableFiles = [], allowedChangePatterns = [], responsibility = null, state = {} }) {
  const [, agentPromptPath] = AGENT_META[agent] || AGENT_META.brain_agent;
  const normalizedPhase = normalizePhase(phase);
  const [taskLabel, defaultResponsibility] = TASK_LABELS[slug] || taskLabelForFallback({ phase: normalizedPhase, slug });
  const displayName = `${taskLabel}｜${AGENT_LABELS[agent] || agent}｜第 ${round} 轮`;
  const gateResultFile = loopDoc('gate-results', `${featureKey}-${slug}-round-${round}.json`);
  const contextFiles = taskContextInputFiles(state);
  const contextSearchPatterns = taskContextSearchPatterns(featureKey);

  return {
    id: `${featureKey}-${slug}-round-${round}`,
    agent,
    windowName: displayName,
    displayName,
    responsibility: responsibility || defaultResponsibility,
    title,
    agentPromptPath,
    outputFiles,
    gateResultFile,
    editableFiles,
    allowedChangePatterns,
    allowCodeChanges,
    inputFiles: unique([...contextFiles, ...inputFiles]),
    inputSearchPatterns: unique([...contextSearchPatterns, ...inputSearchPatterns]),
    phase: normalizedPhase,
    round,
  };
}

function taskContextInputFiles(state = {}) {
  return unique([
    ...REQUIRED_CONTEXT_FILES,
    state.recentIssuesPath,
    state.recentDecisionPath,
    state.archivePath,
  ]).filter(Boolean);
}

function taskContextSearchPatterns(featureKey) {
  return [
    `agent-loop-docs/reviews/${featureKey}-*-round-*.md`,
    `agent-loop-docs/gate-results/${featureKey}-*-round-*.json`,
    `agent-loop-docs/decisions/${featureKey}-*-round-*.md`,
    `agent-loop-docs/issues/${featureKey}-issues-round-*.md`,
    `agent-loop-docs/tech/${featureKey}-*.md`,
    `agent-loop-docs/test-reports/${featureKey}-*.md`,
    `agent-loop-docs/acceptance/${featureKey}-*.md`,
  ];
}

function taskLabelForFallback({ phase, slug }) {
  if (slug.endsWith('-issue-fix')) return ['问题修复', '修复 Gate 自动分派给当前 Agent 的问题'];
  if (slug.endsWith('-recheck')) return ['修复复查', '复查上一轮修复是否满足 Gate 要求'];
  return [phaseTitle(phase), '完成当前阶段要求的 Agent 任务'];
}

function phaseTitle(phase) {
  switch (normalizePhase(phase)) {
    case 'PRODUCT_REVIEW': return '产品初审';
    case 'PRD_REVIEW': return 'PRD 评审';
    case 'ARCHITECTURE_DESIGN': return '架构设计';
    case 'ARCHITECTURE_REVIEW': return '架构验收';
    case 'ARCHITECTURE_IMPACT_REVIEW': return '架构影响评审';
    case 'UI_DESIGN': return 'UI 设计';
    case 'DEVELOPMENT_DESIGN': return '开发方案';
    case 'DESIGN_REVIEW': return '方案评审';
    case 'IMPLEMENTATION': return '开发实现';
    case 'TESTING': return '测试执行';
    case 'PRODUCT_ACCEPTANCE': return '产品验收';
    case 'USER_ACCEPTANCE': return '用户验收准备';
    case 'ARCHIVE': return '项目归档';
    default: return phase;
  }
}

function productEditableFiles(state) {
  if (normalizeProductPrdEditMode(state.productPrdEditMode) === 'direct_edit' && state.prdPath) return [state.prdPath];
  return [];
}

function allowCodeChangesForIssueAgent(agent) {
  return CODE_AGENTS.has(agent) || agent === 'test_agent';
}

function editableFilesForIssueAgent(agent, state) {
  if (agent === 'product_agent') return productEditableFiles(state);
  return [];
}

function allowedChangePatternsForIssueAgent(agent) {
  if (agent === 'test_agent') return TEST_ALLOWED_CHANGE_PATTERNS;
  return [];
}

function productAcceptanceInputSearchPatterns(featureKey) {
  return [
    `agent-loop-docs/test-reports/${featureKey}-test-execution-round-*.md`,
    `agent-loop-docs/test-reports/${featureKey}-frontend-atomic-implementation-round-*.md`,
    `agent-loop-docs/test-reports/${featureKey}-backend-atomic-implementation-round-*.md`,
    `agent-loop-docs/test-reports/${featureKey}-frontend-repair-round-*.md`,
    `agent-loop-docs/test-reports/${featureKey}-backend-repair-round-*.md`,
    `agent-loop-docs/issues/${featureKey}-issues-round-*.md`,
    `agent-loop-docs/decisions/${featureKey}-test-gate-round-*.md`,
  ];
}

function repairOutputForAgent(featureKey, agent, round) {
  switch (agent) {
    case 'product_agent': return loopDoc('reviews', `${featureKey}-product-fix-round-${round}.md`);
    case 'ui_agent': return loopDoc('reviews', `${featureKey}-ui-fix-round-${round}.md`);
    case 'frontend_architect_agent': return loopDoc('tech', `${featureKey}-frontend-architecture-fix-round-${round}.md`);
    case 'backend_architect_agent': return loopDoc('tech', `${featureKey}-backend-architecture-fix-round-${round}.md`);
    case 'frontend_agent': return loopDoc('test-reports', `${featureKey}-frontend-repair-round-${round}.md`);
    case 'backend_agent': return loopDoc('test-reports', `${featureKey}-backend-repair-round-${round}.md`);
    case 'test_agent': return loopDoc('test-reports', `${featureKey}-test-repair-round-${round}.md`);
    case 'repair_agent': return loopDoc('test-reports', `${featureKey}-repair-round-${round}.md`);
    default: return loopDoc('decisions', `${featureKey}-${agentSlug(agent)}-fix-round-${round}.md`);
  }
}

function repairAgentsForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW':
    case 'PRD_REVIEW': return 'product_agent';
    case 'ARCHITECTURE_DESIGN':
    case 'ARCHITECTURE_REVIEW':
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent';
    case 'UI_DESIGN': return 'ui_agent';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN':
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent,frontend_architect_agent,backend_architect_agent';
    case 'IMPLEMENTATION':
    case 'TESTING':
    case 'REPAIR': return 'frontend_agent,backend_agent,test_agent,repair_agent';
    case 'PRODUCT_ACCEPTANCE': return 'product_agent,frontend_agent,backend_agent,test_agent';
    case 'USER_ACCEPTANCE':
    case 'ARCHIVE': return 'brain_agent';
    default: return 'brain_agent';
  }
}

function recheckAgentsForPhase(phase) {
  switch (normalizePhase(phase)) {
    case 'INTAKE':
    case 'PRODUCT_REVIEW':
    case 'PRD_REVIEW': return 'frontend_agent,backend_agent,test_agent,ui_agent,review_agent';
    case 'ARCHITECTURE_DESIGN':
    case 'ARCHITECTURE_REVIEW':
    case 'ARCHITECTURE_IMPACT_REVIEW': return 'frontend_architect_agent,backend_architect_agent,test_agent,review_agent';
    case 'UI_DESIGN': return 'ui_agent,review_agent';
    case 'DEVELOPMENT_DESIGN':
    case 'TECH_DESIGN':
    case 'DESIGN_REVIEW':
    case 'JOINT_TECH_REVIEW': return 'product_agent,ui_agent,test_agent,frontend_architect_agent,backend_architect_agent,review_agent';
    case 'IMPLEMENTATION':
    case 'TESTING':
    case 'REPAIR': return 'test_agent,review_agent';
    case 'PRODUCT_ACCEPTANCE': return 'product_agent,test_agent';
    case 'USER_ACCEPTANCE':
    case 'ARCHIVE': return 'brain_agent';
    default: return 'review_agent';
  }
}

function parseAgentList(value) {
  const agents = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(agents)].filter((agent) => AGENT_META[agent]);
}

function agentSlug(agent) {
  return String(agent).replace(/_agent$/, '').replace(/_/g, '-');
}

function loopDoc(dir, filename) {
  return `${LOOP_DOCS_ROOT}/${dir}/${filename}`;
}

function normalizeGateStatus(value) {
  return String(value || 'DRAFT').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizePhase(value) {
  return String(value || 'INTAKE').toUpperCase().replace(/[ -]/g, '_');
}

function normalizeProductPrdEditMode(value) {
  return String(value || 'review_only').trim().toLowerCase().replace(/[ -]/g, '_');
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}
