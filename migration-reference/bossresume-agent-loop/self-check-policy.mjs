const TASK_KIND_POLICIES = {
  PRODUCT_INITIAL_REVIEW: {
    label: 'Product initial PRD review',
    requiredPatterns: ['需求范围', '不确定问题', '下一步建议'],
  },
  PRODUCT_PRD_FIX: {
    label: 'Product PRD repair',
    requiredPatterns: ['关联问题', '修改内容', '验证结果', '剩余问题'],
  },
  PRD_DOMAIN_REVIEW: {
    label: 'Domain PRD review',
    requiredPatterns: ['评审结论', '问题清单', '是否阻塞'],
  },
  UI_REVIEW: {
    label: 'UI PRD review',
    requiredPatterns: ['评审结论', '信息架构', '交互状态', '是否阻塞'],
  },
  PRD_RECHECK: {
    label: 'PRD issue recheck',
    requiredPatterns: ['复查问题', '已关闭问题', '仍未关闭问题', '新增问题'],
  },
  ISSUE_FIX: {
    label: 'Issue repair',
    requiredPatterns: ['修复范围', '关联问题', '验证结果', '剩余问题'],
  },
  GATE_RESULT_REPAIR: {
    label: 'Structured Gate result repair',
    requiredPatterns: ['修复的 Gate Result', '合同错误', '验证结果'],
  },
  GATE_VERIFY: {
    label: 'Gate verifier',
    requiredPatterns: [],
    skipSelfCheckPolicy: true,
  },
  UI_DESIGN: {
    label: 'UI page structure and visual specification',
    requiredPatterns: ['页面结构', '视觉规范', '交互状态', '组件规范'],
  },
  TECH_PLAN: {
    label: 'Technical plan',
    requiredPatterns: ['设计方案', '原子任务', '实施计划', '自测标准', '风险'],
  },
  IMPLEMENTATION: {
    label: 'Atomic implementation with self test',
    requiredPatterns: ['原子任务', '设计文档', '变更范围', '自测命令', '测试结果'],
  },
  TEST_EXECUTION: {
    label: 'Test execution',
    requiredPatterns: ['测试范围', '测试结果', '缺陷汇总'],
  },
  PRODUCT_ACCEPTANCE: {
    label: 'Product acceptance',
    requiredPatterns: ['PRD 逐条对照', '测试报告引用', '需求偏差', '体验验收', '遗留问题'],
  },
};

const PHASE_TO_TASK_KIND = {
  INTAKE: 'PRODUCT_INITIAL_REVIEW',
  PRODUCT_REVIEW: 'PRODUCT_PRD_FIX',
  PRD_REVIEW: 'PRD_DOMAIN_REVIEW',
  UI_DESIGN: 'UI_DESIGN',
  DEVELOPMENT_DESIGN: 'TECH_PLAN',
  TECH_DESIGN: 'TECH_PLAN',
  IMPLEMENTATION: 'IMPLEMENTATION',
  TESTING: 'TEST_EXECUTION',
  REPAIR: 'ISSUE_FIX',
  PRODUCT_ACCEPTANCE: 'PRODUCT_ACCEPTANCE',
};

const LEGACY_PHASE_POLICIES = {
  ARCHITECTURE_DESIGN: ['架构设计', '边界', '风险', '验收标准'],
  ARCHITECTURE_REVIEW: ['架构验收', '风险', '是否通过'],
  ARCHITECTURE_IMPACT_REVIEW: ['现有架构', '影响范围', '风险', '是否通过'],
  DESIGN_REVIEW: ['评审结论', '问题清单', '产品需求', '原子任务'],
  JOINT_TECH_REVIEW: ['评审结论', '问题清单', '产品需求', '原子任务'],
  USER_ACCEPTANCE: ['用户验收', '检查清单', '确认项', '用户明确确认', '用户确认记录'],
  ARCHIVE: ['归档范围', '归档路径', '归档结论'],
};

export function validatePhaseSelfCheck({ phase, taskKind, task, content }) {
  const inferredTaskKind = taskKind || inferTaskKindFromContent(content);
  const policy = resolveSelfCheckPolicy({ phase, taskKind: inferredTaskKind, task });
  if (!policy || policy.skipSelfCheckPolicy) return [];
  return policy.requiredPatterns.filter((pattern) => !String(content || '').includes(pattern));
}

export function selfCheckPolicyText(phase, context = {}) {
  const policy = resolveSelfCheckPolicy({ phase, ...context });
  if (!policy) return '- 通用要求：必须说明检查范围、结论、是否允许进入下一阶段。';
  if (policy.skipSelfCheckPolicy) return '- 本任务为 Gate Verifier，只输出结构化 Gate 判定因子，不套用 Agent Self Check 模板。';

  return [
    `- 任务类型：${resolveTaskKind({ phase, ...context })} (${policy.label})`,
    `- Self Check 内容必须覆盖：${policy.requiredPatterns.join('、') || '无额外阶段字段'}`,
    '- 仍然必须包含：结论：PASS/FAIL/BLOCKED',
    '- 仍然必须包含：是否允许进入下一阶段：是/否',
  ].join('\n');
}

export function resolveSelfCheckPolicy({ phase, taskKind, task } = {}) {
  const resolvedTaskKind = resolveTaskKind({ phase, taskKind, task });
  if (TASK_KIND_POLICIES[resolvedTaskKind]) return TASK_KIND_POLICIES[resolvedTaskKind];

  const normalizedPhase = normalizePhase(phase);
  const legacyPatterns = LEGACY_PHASE_POLICIES[normalizedPhase];
  if (!legacyPatterns) return null;
  return { label: normalizedPhase, requiredPatterns: legacyPatterns };
}

export function resolveTaskKind({ phase, taskKind, task } = {}) {
  const explicit = taskKind || task?.taskKind || task?.task_kind || task?.kind;
  if (explicit) return normalizeTaskKind(explicit);

  const slug = String(task?.slug || task?.id || '').toLowerCase();
  if (slug.includes('gate-result') && slug.includes('repair')) return 'GATE_RESULT_REPAIR';
  if (slug.includes('recheck')) return 'PRD_RECHECK';
  if (slug.includes('ui') && normalizePhase(phase) === 'PRD_REVIEW') return 'UI_REVIEW';
  if (slug.includes('gate') && (slug.includes('verify') || slug.includes('verifier'))) return 'GATE_VERIFY';

  return PHASE_TO_TASK_KIND[normalizePhase(phase)] || normalizeTaskKind(phase || 'PRODUCT_INITIAL_REVIEW');
}

function inferTaskKindFromContent(content) {
  const value = String(content || '');
  if (/复查问题|rechecked_issue_ids|closed_issue_ids|still_open_issue_ids/i.test(value)) return 'PRD_RECHECK';
  if (/修复的 Gate Result|gate_result_repair|合同错误/i.test(value)) return 'GATE_RESULT_REPAIR';
  if (/Gate 判定因子|gate_decision_factors|row_passed/i.test(value)) return 'GATE_VERIFY';
  return null;
}

function normalizeTaskKind(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizePhase(value) {
  return String(value || 'INTAKE').trim().toUpperCase().replace(/[ -]/g, '_');
}
