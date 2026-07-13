export function buildWorkflowRecommendation({
  workflowStatus,
  controllerStep,
  humanIssueIds = [],
  ownerAgents = [],
  failureReason = null,
} = {}) {
  const status = String(workflowStatus || '').trim().toUpperCase();
  const owners = Array.isArray(ownerAgents) ? ownerAgents : String(ownerAgents || '').split(',').map((item) => item.trim()).filter(Boolean);

  if (status === 'READY') {
    return {
      action: 'CONTINUE_SINGLE',
      command: 'npm run agent -- next --mode=single',
      message: '当前阶段已准备完成，可以单轮继续。',
    };
  }

  if (status === 'NEEDS_FIX') {
    return {
      action: 'RUN_OWNER_FIX',
      command: 'npm run agent -- next --mode=single',
      message: `当前问题可由 Owner Agent 修复，不需要用户决策。${owners.length ? ` Owner：${owners.join(', ')}。` : ''}`,
    };
  }

  if (status === 'NEEDS_USER') {
    return {
      action: 'REQUEST_USER_DECISION',
      command: 'npm run agent -- chat',
      message: '当前存在真实业务决策问题，需要用户确认。',
      issueIds: humanIssueIds,
    };
  }

  if (status === 'BLOCKED_BY_SYSTEM') {
    return {
      action: 'FIX_SYSTEM',
      command: null,
      message: `当前属于 Agent Loop 系统阻塞，不要执行 next 或 decide。${failureReason ? ` failure_reason=${failureReason}。` : ''}`,
    };
  }

  if (status === 'RUNNING') {
    return {
      action: 'WAIT_FOR_CURRENT_RUN',
      command: null,
      message: '当前任务仍在运行，不要重复启动 Agent Loop。',
    };
  }

  if (status === 'DONE') {
    return {
      action: 'NONE',
      command: null,
      message: '当前 Workflow 已完成。',
    };
  }

  return {
    action: controllerStep === 'SYSTEM_FIX' ? 'FIX_SYSTEM' : 'INSPECT_STATE',
    command: null,
    message: '当前状态无法安全推导下一步，请先检查 workflow-state.json 和强审计日志。',
  };
}
