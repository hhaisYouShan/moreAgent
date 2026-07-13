import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendAuditEvent } from './audit-log.mjs';
import { validatePhaseSelfCheck } from './self-check-policy.mjs';
import { parseSelfCheck } from './self-check-parser.mjs';
import { validateGateResultContract } from './gate-result-validator.mjs';

const PRD_REVIEW_STANDARD = 'agent-loop-docs/process/prd-review-standard.md';
const CONFIRMED_DECISIONS_PATH = 'agent-loop-docs/process/confirmed-decisions.json';
const CONVERSATION_PATH = 'agent-loop-docs/process/brain-conversation.jsonl';
const DECISION_TYPES = new Set(['AUTO_FIXABLE', 'HUMAN_DECISION_REQUIRED']);
const OPEN_STATUSES = new Set(['OPEN', 'PENDING', 'TODO', 'UNRESOLVED']);
const CLOSED_STATUSES = new Set(['CLOSED', 'RESOLVED', 'DONE', 'FIXED']);
const BEIJING_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 北京时间$/;

export async function summarizeGate({ tasks, worktrees, statuses, scopeViolations = new Map(), codeIntegration = new Map(), state = {}, runId = null, repoRoot = process.cwd() }) {
  const rows = [];

  for (const task of tasks) {
    const status = statuses.find((item) => item.task === task.id);
    const worktree = worktrees.get(task.id);
    const outputChecks = await Promise.all(task.outputFiles.map((file) => checkOutputFile(path.join(worktree.worktreePath, file), file, task.phase, { task, state })));
    const gateResultCheck = await checkGateResultFile(path.join(worktree.worktreePath, task.gateResultFile), task.gateResultFile, { task, worktreePath: worktree.worktreePath });
    const missingOutputs = outputChecks.filter((item) => !item.exists).map((item) => item.file);
    const blockedOutputs = outputChecks.filter((item) => item.selfCheckConclusion === 'BLOCKED').map((item) => item.file);
    const failedOutputs = outputChecks.filter((item) => item.selfCheckConclusion === 'FAIL').map((item) => item.file);
    const selfCheckMissing = outputChecks.filter((item) => item.exists && !item.hasSelfCheck).map((item) => item.file);
    const nextStageDenied = outputChecks.filter((item) => item.exists && item.allowsNextStage === false).map((item) => item.file);
    const phaseRequirementsMissing = outputChecks.filter((item) => item.phaseRequirementsMissing.length > 0).map((item) => ({ file: item.file, missing: item.phaseRequirementsMissing }));
    const semanticIssues = outputChecks.flatMap((item) => item.semanticIssues || []);
    const gateResultIssues = gateResultCheck.issues || [];
    const semanticBlockers = semanticIssues.filter((item) => item.severity === 'BLOCKER');
    const semanticMajors = semanticIssues.filter((item) => item.severity === 'MAJOR');
    const gateResultBlockers = gateResultIssues.filter((item) => item.severity === 'BLOCKER');
    const gateResultMajors = gateResultIssues.filter((item) => item.severity === 'MAJOR');
    const disallowedChanges = scopeViolations.get(task.id) || [];
    const integration = codeIntegration.get(task.id) || { files: [], conflicts: [], unsupported: [] };
    const codeIntegrationConflicts = integration.conflicts || [];
    const unsupportedCodeChanges = integration.unsupported || [];
    const integratedCodeFiles = integration.files || [];

    const passed = status?.status === 'done' && missingOutputs.length === 0 && blockedOutputs.length === 0 && failedOutputs.length === 0 && selfCheckMissing.length === 0 && nextStageDenied.length === 0 && phaseRequirementsMissing.length === 0 && semanticIssues.length === 0 && gateResultIssues.length === 0 && gateResultCheck.passed === true && disallowedChanges.length === 0 && codeIntegrationConflicts.length === 0 && unsupportedCodeChanges.length === 0 && outputChecks.every((item) => item.selfCheckConclusion === 'PASS');
    const factors = buildDecisionFactors({ task, status, outputChecks, gateResultCheck, missingOutputs, blockedOutputs, failedOutputs, selfCheckMissing, nextStageDenied, phaseRequirementsMissing, semanticIssues, gateResultIssues, disallowedChanges, codeIntegrationConflicts, unsupportedCodeChanges, passed });

    await appendAuditEvent({
      repoRoot,
      event: 'gate_row_evaluated',
      runId,
      phase: task.phase,
      gate: state.gate || null,
      taskId: task.id,
      agent: task.agent,
      data: { row_passed: passed, task_status: status?.status || 'unknown', exit_code: status?.exitCode ?? null },
      message: `${task.id} Gate row evaluated: passed=${passed}`,
    });

    await appendAuditEvent({
      repoRoot,
      event: 'gate_decision_factors',
      level: factors.verifier_inconsistent ? 'warn' : 'info',
      runId,
      phase: task.phase,
      gate: state.gate || null,
      taskId: task.id,
      agent: task.agent,
      data: factors,
      message: factors.diagnostic || `Gate factors for ${task.id}: ${factors.failure_reason || 'none'}`,
    });

    rows.push({ task: task.id, agent: task.agent, phase: task.phase, status: status?.status || 'unknown', exitCode: status?.exitCode ?? null, taskReason: status?.reason || status?.statusReason || null, expectedOutputs: task.outputFiles, gateResultFile: task.gateResultFile, missingOutputs, selfCheckMissing, blockedOutputs, failedOutputs, nextStageDenied, phaseRequirementsMissing, semanticIssues, semanticBlockers, semanticMajors, gateResultCheck, gateResultIssues, gateResultBlockers, gateResultMajors, disallowedChanges, integratedCodeFiles, codeIntegrationConflicts, unsupportedCodeChanges, outputChecks, decisionFactors: factors, passed });
  }

  const hasBlocked = rows.some((row) => row.blockedOutputs.length > 0 || row.semanticBlockers.length > 0 || row.gateResultBlockers.length > 0 || row.codeIntegrationConflicts.length > 0 || row.unsupportedCodeChanges.length > 0);
  const allPassed = rows.every((row) => row.passed);
  return { status: allPassed ? 'APPROVED' : hasBlocked ? 'BLOCKED' : 'CHANGES_REQUESTED', rows };
}

async function checkOutputFile(absolutePath, file, phase, context) {
  if (!existsSync(absolutePath)) return { file, exists: false, hasSelfCheck: false, selfCheckConclusion: null, selfCheckConclusionRaw: null, allowsNextStage: null, allowsNextStageRaw: null, documentConclusion: null, phaseRequirementsMissing: [], semanticIssues: [] };
  const content = await readFile(absolutePath, 'utf8');
  const hasSelfCheck = /(^|\n)##\s+Self Check\b/i.test(content);
  const selfCheckContent = extractSelfCheck(content);
  const parsedSelfCheck = hasSelfCheck ? parseSelfCheck(selfCheckContent) : null;
  const selfCheckConclusionRaw = parsedSelfCheck?.raw?.conclusion || null;
  const allowsNextStageRaw = parsedSelfCheck?.raw?.allows_next_stage || null;
  const selfCheckConclusion = parsedSelfCheck?.conclusion || null;
  const allowsNextStage = parsedSelfCheck?.allows_next_stage ?? null;
  const task = context?.task || {};
  const phaseRequirementsMissing = hasSelfCheck
    ? validatePhaseSelfCheck({ phase, taskKind: task.taskKind || task.task_kind || task.kind, task, content })
    : [];
  const semanticIssues = buildStructuralMarkdownIssues({ content, file, phase, context });
  return { file, exists: true, hasSelfCheck, selfCheckConclusion, selfCheckConclusionRaw, allowsNextStage, allowsNextStageRaw, selfCheckParseErrors: parsedSelfCheck?.parse_errors || [], documentConclusion: null, phaseRequirementsMissing, semanticIssues };
}

async function checkGateResultFile(absolutePath, file, { task, worktreePath }) {
  if (!file || !existsSync(absolutePath)) {
    return {
      file,
      exists: false,
      passed: false,
      conclusion: null,
      data: null,
      issues: [issue({ file, severity: 'MAJOR', kind: 'missing_gate_result_json', message: `Structured Gate result was not created: ${file}.`, expectedFix: 'Create gate_result.json with conclusion, issues[], open_questions[], owner_agents, target_files, and verification.', ownerAgent: task.agent, decisionType: 'AUTO_FIXABLE', category: 'OUTPUT_CONTRACT', failureReason: 'missing_gate_result_json', taskKind: 'GATE_RESULT_REPAIR' })],
      openIssueCount: 0,
    };
  }

  let data;
  try {
    data = JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    return {
      file,
      exists: true,
      passed: false,
      conclusion: null,
      data: null,
      issues: [issue({ file, severity: 'BLOCKER', kind: 'invalid_gate_result_json', message: `Structured Gate result is not valid JSON: ${file}. ${error.message}`, expectedFix: 'Fix the Gate result writer/parser before rerunning this task.', ownerAgent: 'gate_verifier', decisionType: 'AUTO_FIXABLE', category: 'SYSTEM', failureReason: 'invalid_gate_result_json', taskKind: 'GATE_VERIFY' })],
      openIssueCount: 0,
    };
  }

  const contract = validateGateResultContract(data, { ownerAgent: task.agent, file });
  const conclusion = contract.conclusion;
  const structuredIssues = normalizeStructuredIssues(data, { file, task });
  const contractIssues = contract.issues.map((contractProblem) => issue({
    file,
    severity: contractProblem.severity || 'MAJOR',
    kind: contractProblem.kind,
    message: contractProblem.message,
    expectedFix: contractProblem.category === 'SYSTEM' ? 'Fix the Gate parser/validator before rerunning the Agent.' : 'Repair only the structured Gate result contract and rerun the Gate.',
    ownerAgent: contractProblem.owner_agent || task.agent,
    targetFiles: contractProblem.target_files || [file],
    decisionType: contractProblem.decision_type || 'AUTO_FIXABLE',
    category: contractProblem.category,
    failureReason: contractProblem.failure_reason,
    taskKind: contractProblem.task_kind,
  }));
  const userAcceptanceIssues = await checkUserAcceptanceGateResult(data, { file, task, conclusion, worktreePath });
  const issues = dedupeGateIssues([...contractIssues, ...structuredIssues, ...userAcceptanceIssues]);

  return {
    file,
    exists: true,
    passed: issues.length === 0 && conclusion === 'PASS',
    conclusion,
    data,
    issues,
    openIssueCount: structuredIssues.length,
    contract,
  };
}

function normalizeStructuredIssues(data, { file, task }) {
  const normalized = [];
  const rawIssues = asArray(data.issues);
  const legacyBlockers = asArray(data.blockers).map((item) => ({ severity: 'BLOCKER', problem: item, issue_type: 'gate_result_blocker' }));
  const legacyMajors = asArray(data.majors).map((item) => ({ severity: 'MAJOR', problem: item, issue_type: 'gate_result_major' }));
  const openQuestions = asArray(data.open_questions).map((item) => typeof item === 'object' && item !== null ? { ...item, severity: item.severity || 'BLOCKER', decision_type: item.decision_type || 'HUMAN_DECISION_REQUIRED', issue_type: item.issue_type || 'gate_result_open_question', problem: item.problem || item.question || item.message || JSON.stringify(item) } : { severity: 'BLOCKER', decision_type: 'HUMAN_DECISION_REQUIRED', issue_type: 'gate_result_open_question', problem: String(item) });

  for (const rawIssue of [...rawIssues, ...legacyBlockers, ...legacyMajors, ...openQuestions]) {
    if (!rawIssue) continue;
    const objectIssue = typeof rawIssue === 'object' ? rawIssue : { problem: String(rawIssue) };
    const status = normalizeIssueStatus(objectIssue.status || 'OPEN');
    if (CLOSED_STATUSES.has(status)) continue;
    if (!OPEN_STATUSES.has(status)) {
      normalized.push(issue({ file, severity: 'MAJOR', kind: 'gate_result_issue_status_invalid', message: `Structured Gate issue has invalid status \`${objectIssue.status}\` in ${file}.`, expectedFix: 'Set status to OPEN or CLOSED/RESOLVED/DONE/FIXED.', ownerAgent: task.agent, targetFiles: targetFilesFromIssue(objectIssue, data, file), decisionType: 'AUTO_FIXABLE' }));
      continue;
    }

    const decisionType = normalizeDecisionType(objectIssue.decision_type || objectIssue.decisionType);
    if (!decisionType) {
      normalized.push(issue({ file, severity: 'MAJOR', kind: 'gate_result_issue_decision_type_missing', message: `Structured Gate issue is OPEN but missing decision_type in ${file}: ${issueProblem(objectIssue)}`, expectedFix: 'Set decision_type to AUTO_FIXABLE or HUMAN_DECISION_REQUIRED. Do not rely on Markdown wording or keyword guessing.', ownerAgent: task.agent, targetFiles: targetFilesFromIssue(objectIssue, data, file), decisionType: 'AUTO_FIXABLE' }));
      continue;
    }

    const severity = normalizeSeverity(objectIssue.severity, decisionType);
    const ownerAgent = firstOwnerFromIssue(objectIssue, data, task.agent);
    normalized.push(issue({
      file,
      severity,
      kind: objectIssue.issue_type || objectIssue.kind || 'gate_result_open_issue',
      message: issueProblem(objectIssue),
      expectedFix: objectIssue.expected_fix || objectIssue.expectedFix || (decisionType === 'HUMAN_DECISION_REQUIRED' ? 'Ask the user through Brain Agent and update the structured Gate result after confirmation.' : 'Fix the issue through the owner Agent and rerun the Gate.'),
      ownerAgent: decisionType === 'HUMAN_DECISION_REQUIRED' ? 'brain_agent' : ownerAgent,
      targetFiles: targetFilesFromIssue(objectIssue, data, file),
      decisionType,
      issueStatus: status,
    }));
  }

  return normalized;
}

async function checkUserAcceptanceGateResult(data, { file, task, conclusion, worktreePath }) {
  if (normalizePhase(task.phase) !== 'USER_ACCEPTANCE') return [];
  if (conclusion !== 'PASS') return [];

  const targetFilesForIssue = unique([file, ...(task.outputFiles || []), CONFIRMED_DECISIONS_PATH, CONVERSATION_PATH]);
  const issues = [];
  const confirmedAt = String(data.confirmed_at || '').trim();
  const gateTaskId = String(data.task_id || '').trim();
  const gateRound = Number(data.round);
  const expectedRound = Number(task.round || 0);

  if (data.user_confirmed !== true) {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_confirmation_missing', message: 'USER_ACCEPTANCE_GATE cannot PASS because gate_result.json does not contain user_confirmed: true.', expectedFix: 'Ask the user for explicit acceptance through /accept. If and only if the user confirms, rerun the Gate with matching gate_result.json fields.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  if (normalizeConfirmedBy(data.confirmed_by) !== 'USER') {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_confirmed_by_invalid', message: 'USER_ACCEPTANCE_GATE cannot PASS because confirmed_by is not "user".', expectedFix: 'Set confirmed_by to "user" only after the CLI /accept command records explicit user confirmation.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  if (!BEIJING_TIMESTAMP_PATTERN.test(confirmedAt)) {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_confirmed_at_invalid', message: 'USER_ACCEPTANCE_GATE cannot PASS because confirmed_at is missing or not exactly in the required Beijing time format.', expectedFix: 'Use the confirmed_at value written by /accept, formatted as YYYY-MM-DD HH:mm:ss 北京时间.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  if (gateTaskId !== task.id) {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_task_id_mismatch', message: `USER_ACCEPTANCE_GATE cannot PASS because gate_result.json task_id does not match current task id. expected=${task.id}, actual=${gateTaskId || 'EMPTY'}.`, expectedFix: 'Use the current USER_ACCEPTANCE task_id in gate_result.json and in the /accept decision record.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  if (!Number.isInteger(gateRound) || gateRound !== expectedRound) {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_round_mismatch', message: `USER_ACCEPTANCE_GATE cannot PASS because gate_result.json round does not match current round. expected=${expectedRound}, actual=${Number.isFinite(gateRound) ? gateRound : 'EMPTY'}.`, expectedFix: 'Use the current USER_ACCEPTANCE round in gate_result.json and in the /accept decision record.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  const decisionCheck = await readConfirmedUserAcceptanceDecision({ data, task, confirmedAt });
  if (!decisionCheck.ok) {
    issues.push(issue({ file, severity: 'BLOCKER', kind: 'user_acceptance_confirmed_decision_missing', message: decisionCheck.message, expectedFix: 'Run /accept from the chat CLI or npm run agent -- accept during USER_ACCEPTANCE. The record must include feature_key, task_id, round and confirmed_at that exactly match the Gate Result.', ownerAgent: 'brain_agent', targetFiles: targetFilesForIssue, decisionType: 'HUMAN_DECISION_REQUIRED' }));
  }

  return issues;
}

async function readConfirmedUserAcceptanceDecision({ data, task, confirmedAt }) {
  const root = process.cwd();
  const decisionsPath = path.join(root, CONFIRMED_DECISIONS_PATH);
  if (!existsSync(decisionsPath)) return { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because ${CONFIRMED_DECISIONS_PATH} does not exist in main workspace.` };

  let parsed;
  try {
    parsed = JSON.parse(await readFile(decisionsPath, 'utf8'));
  } catch (error) {
    return { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because ${CONFIRMED_DECISIONS_PATH} is not valid JSON: ${error.message}` };
  }

  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const featureKey = featureKeyFromTask(task);
  const matched = decisions.find((decision) => isMatchingUserAcceptanceDecision({ decision, featureKey, confirmedAt, task }));
  if (!matched) {
    return { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because main workspace ${CONFIRMED_DECISIONS_PATH} has no strict matching USER_ACCEPTANCE record from the user. Required: feature_key=${featureKey}, task_id=${task.id}, round=${task.round}, confirmed_at=${confirmedAt}.` };
  }

  const conversationCheck = await hasMatchingAcceptanceConversationEntry({ root, decision: matched, task, confirmedAt });
  if (!conversationCheck.ok) return conversationCheck;

  return { ok: true, decision: matched };
}

function isMatchingUserAcceptanceDecision({ decision, featureKey, confirmedAt, task }) {
  if (!decision || typeof decision !== 'object') return false;
  const decisionType = normalizeDecisionKind(decision.type || decision.decision_type || decision.kind || decision.phase);
  const confirmedBy = normalizeConfirmedBy(decision.confirmed_by || decision.by || decision.source_role || decision.role);
  const source = normalizeConfirmedBy(decision.source || decision.source_type || decision.source_role || decision.role);
  const sourceChannel = normalizeDecisionKind(decision.source_channel || decision.channel || '');
  const status = normalizeConfirmedStatus(decision.status || decision.result || '');
  const decisionFeature = String(decision.featureKey || decision.feature_key || '').trim();
  const decisionTaskId = String(decision.task_id || decision.acceptance_task_id || '').trim();
  const decisionRound = Number(decision.round);
  const decisionConfirmedAt = String(decision.confirmed_at || '').trim();

  if (decisionType !== 'USER_ACCEPTANCE') return false;
  if (decision.user_confirmed !== true) return false;
  if (confirmedBy !== 'USER' || source !== 'USER') return false;
  if (sourceChannel !== 'AGENT_CLI') return false;
  if (status !== 'CONFIRMED') return false;
  if (!featureKey || !decisionFeature || decisionFeature !== featureKey) return false;
  if (!decisionTaskId || decisionTaskId !== task.id) return false;
  if (!Number.isInteger(decisionRound) || decisionRound !== Number(task.round || 0)) return false;
  if (!decisionConfirmedAt || !BEIJING_TIMESTAMP_PATTERN.test(decisionConfirmedAt)) return false;
  if (!confirmedAt || decisionConfirmedAt !== confirmedAt) return false;
  return true;
}

async function hasMatchingAcceptanceConversationEntry({ root, decision, task, confirmedAt }) {
  const conversationPath = path.join(root, CONVERSATION_PATH);
  if (!existsSync(conversationPath)) return { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because main workspace ${CONVERSATION_PATH} does not exist. The /accept CLI command must write the raw user input.` };

  let lines;
  try {
    lines = (await readFile(conversationPath, 'utf8')).split('\n').filter(Boolean);
  } catch (error) {
    return { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because ${CONVERSATION_PATH} cannot be read: ${error.message}` };
  }

  const matched = lines.map(parseJsonLine).filter(Boolean).some((entry) => {
    const role = normalizeDecisionKind(entry.role);
    const command = normalizeDecisionKind(entry.command);
    const round = Number(entry.round);
    return role === 'USER'
      && command === 'ACCEPT'
      && String(entry.acceptance_decision_id || '').trim() === String(decision.id || '').trim()
      && String(entry.task_id || '').trim() === task.id
      && Number.isInteger(round)
      && round === Number(task.round || 0)
      && String(entry.confirmed_at || '').trim() === confirmedAt;
  });

  return matched
    ? { ok: true }
    : { ok: false, message: `USER_ACCEPTANCE_GATE cannot PASS because main workspace ${CONVERSATION_PATH} has no matching /accept raw user input entry for decision ${decision.id || 'UNKNOWN'}.` };
}

function isUserAcceptanceAwaitingUser(data, task) {
  if (normalizePhase(task.phase) !== 'USER_ACCEPTANCE') return false;
  const questions = asArray(data.open_questions);
  const issues = asArray(data.issues).filter((item) => item && typeof item === 'object');
  return questions.length > 0 || issues.some((item) => normalizeDecisionType(item.decision_type || item.decisionType) === 'HUMAN_DECISION_REQUIRED');
}

function buildStructuralMarkdownIssues({ content, file, phase, context }) {
  const issues = [];
  const normalizedPhase = normalizePhase(phase);
  const task = context?.task || {};

  // Markdown is intentionally limited to structural checks only. It must not decide current blockers by scanning BLOCKER/MAJOR/Open Questions in the body.
  if (isPrdReviewPhase(normalizedPhase) && !content.includes(PRD_REVIEW_STANDARD)) {
    issues.push(issue({ file, severity: 'MAJOR', kind: 'prd_review_standard_missing', message: `PRD Review output does not cite ${PRD_REVIEW_STANDARD}: ${file}.`, expectedFix: `Update the Review Basis to cite and follow ${PRD_REVIEW_STANDARD}.`, ownerAgent: task.agent, decisionType: 'AUTO_FIXABLE' }));
  }

  return issues;
}

function buildDecisionFactors({ task, status, outputChecks, gateResultCheck, missingOutputs, blockedOutputs, failedOutputs, selfCheckMissing, nextStageDenied, phaseRequirementsMissing, semanticIssues, gateResultIssues, disallowedChanges, codeIntegrationConflicts, unsupportedCodeChanges, passed }) {
  const firstOutput = outputChecks[0] || {};
  const taskReason = status?.reason || status?.statusReason || null;
  const failureReason = gateFailureReason({ taskStatus: status?.status, taskReason, missingOutputs, blockedOutputs, failedOutputs, selfCheckMissing, nextStageDenied, phaseRequirementsMissing, semanticIssues, gateResultIssues, gateResultCheck, disallowedChanges, codeIntegrationConflicts, unsupportedCodeChanges, firstOutput });
  const gateResultOpenIssues = gateResultCheck.openIssueCount ?? (gateResultCheck.issues || []).length;
  const verifierInconsistent = gateResultCheck.conclusion === 'PASS'
    && gateResultOpenIssues === 0
    && gateResultIssues.length === 0
    && !passed;
  const outputFilesPresent = outputChecks.filter((item) => item.exists).map((item) => item.file);
  const diagnostic = verifierInconsistent
    ? `Verifier inconsistent: gate_result=PASS/open_issues=0 but row_passed=false. failure_reason=${failureReason || 'unknown'}.`
    : failureReason === 'git_mutation_blocked'
      ? `Git mutation blocked is a system execution error. output_files_present=${outputFilesPresent.length ? outputFilesPresent.join(', ') : 'none'}. Fix the prompt/runner and decide whether to rerun the same Agent.`
    : null;

  return {
    task_id: task.id,
    agent: task.agent,
    task_status: status?.status || 'unknown',
    exit_code: status?.exitCode ?? null,
    task_reason: taskReason,
    self_check_found: Boolean(firstOutput.hasSelfCheck),
    self_check_conclusion_raw: firstOutput.selfCheckConclusionRaw || null,
    self_check_conclusion_parsed: firstOutput.selfCheckConclusion || null,
    allows_next_stage_raw: firstOutput.allowsNextStageRaw || null,
    allows_next_stage_parsed: firstOutput.allowsNextStage ?? null,
    gate_result_conclusion: gateResultCheck.conclusion || null,
    gate_result_open_issues: gateResultOpenIssues,
    markdown_structural_issues: semanticIssues.length,
    phase_requirements_missing: phaseRequirementsMissing.length,
    missing_outputs: missingOutputs.length,
    blocked_outputs: blockedOutputs.length,
    failed_outputs: failedOutputs.length,
    self_check_missing: selfCheckMissing.length,
    next_stage_denied: nextStageDenied.length,
    gate_result_issues: gateResultIssues.length,
    disallowed_changes: disallowedChanges.length,
    code_integration_conflicts: codeIntegrationConflicts.length,
    unsupported_code_changes: unsupportedCodeChanges.length,
    row_passed: passed,
    failure_reason: failureReason,
    verifier_inconsistent: verifierInconsistent,
    diagnostic,
    output_files_present: outputFilesPresent,
  };
}

function gateFailureReason({ taskStatus, taskReason, missingOutputs, blockedOutputs, failedOutputs, selfCheckMissing, nextStageDenied, phaseRequirementsMissing, semanticIssues, gateResultIssues, gateResultCheck, disallowedChanges, codeIntegrationConflicts, unsupportedCodeChanges, firstOutput }) {
  if (taskStatus !== 'done') return normalizeTaskFailureReason(taskReason);
  if (missingOutputs.length) return 'missing_output';
  if (selfCheckMissing.length) return 'self_check_missing';
  if (firstOutput?.hasSelfCheck && firstOutput.selfCheckConclusion === null) return 'self_check_parse_failed';
  if (blockedOutputs.length) return 'self_check_blocked';
  if (failedOutputs.length) return 'self_check_failed';
  if (firstOutput?.hasSelfCheck && firstOutput.allowsNextStage === null) return 'allows_next_stage_parse_failed';
  if (nextStageDenied.length) return 'next_stage_denied';
  if (phaseRequirementsMissing.length) return 'phase_self_check_incomplete';
  if (semanticIssues.length) return 'markdown_structural_issue';
  if (gateResultIssues.length) return gateResultIssues[0]?.kind || 'gate_result_issue';
  if (!gateResultCheck.passed) return 'gate_result_not_passed';
  if (disallowedChanges.length) return 'disallowed_change';
  if (codeIntegrationConflicts.length) return 'code_integration_conflict';
  if (unsupportedCodeChanges.length) return 'unsupported_code_change';
  return null;
}

function normalizeTaskFailureReason(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'task_not_done';
  if (normalized === 'git_mutation_blocked') return 'git_mutation_blocked';
  if (normalized === 'agent_not_found') return 'agent_not_found';
  if (['engine_exit_nonzero', 'script_exited_without_status', 'received_signal'].includes(normalized)) return 'engine_failed';
  return normalized.replace(/[ -]/g, '_');
}

function issue({ file, severity, kind, message, expectedFix, ownerAgent, targetFiles, decisionType, issueStatus, category = null, failureReason = null, taskKind = null }) {
  const normalizedDecisionType = normalizeDecisionType(decisionType) || 'AUTO_FIXABLE';
  const normalizedCategory = category || inferGateIssueCategory({ kind, decisionType: normalizedDecisionType });
  return {
    file,
    sourceFile: file,
    severity,
    kind,
    message,
    expectedFix,
    ownerAgent,
    targetFiles: targetFiles || [file].filter(Boolean),
    decisionType: normalizedDecisionType,
    issueStatus,
    category: normalizedCategory,
    decision_type: normalizedDecisionType,
    requires_user_decision: normalizedDecisionType === 'HUMAN_DECISION_REQUIRED',
    failure_reason: failureReason || kind,
    task_kind: taskKind || (normalizedCategory === 'OUTPUT_CONTRACT' ? 'GATE_RESULT_REPAIR' : normalizedCategory === 'SYSTEM' ? 'GATE_VERIFY' : null),
  };
}

function inferGateIssueCategory({ kind, decisionType }) {
  const normalizedKind = String(kind || '').toLowerCase();
  if (['invalid_gate_result_json', 'gate_result_contract_invalid', 'self_check_parse_failed', 'allows_next_stage_parse_failed', 'phase_self_check_policy_mismatch', 'verifier_inconsistent'].includes(normalizedKind)) return 'SYSTEM';
  if (normalizedKind.startsWith('gate_result_') || ['missing_gate_result_json', 'missing_self_check', 'phase_self_check_incomplete'].includes(normalizedKind)) return 'OUTPUT_CONTRACT';
  if (decisionType === 'HUMAN_DECISION_REQUIRED') return 'BUSINESS';
  return 'IMPLEMENTATION';
}

function dedupeGateIssues(items) {
  const byKey = new Map();
  for (const item of items.filter(Boolean)) {
    const key = [item.kind, item.message, item.sourceFile || item.file].join('|');
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function normalizeConclusion(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
  return ['PASS', 'CHANGES_REQUESTED', 'BLOCKED', 'FAIL'].includes(normalized) ? normalized : null;
}

function normalizeSeverity(value, decisionType) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
  if (['BLOCKER', 'MAJOR', 'MINOR'].includes(normalized)) return normalized === 'MINOR' ? 'MAJOR' : normalized;
  return decisionType === 'HUMAN_DECISION_REQUIRED' ? 'BLOCKER' : 'MAJOR';
}

function normalizeDecisionType(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
  return DECISION_TYPES.has(normalized) ? normalized : null;
}

function normalizeIssueStatus(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeConfirmedBy(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeDecisionKind(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function normalizeConfirmedStatus(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]/g, '_');
}

function firstOwner(data, fallback) {
  const owners = asArray(data.owner_agents).filter(Boolean);
  return owners[0] || fallback;
}

function firstOwnerFromIssue(issueData, data, fallback) {
  const issueOwners = asArray(issueData.owner_agents || issueData.owner_agent).filter(Boolean);
  return issueOwners[0] || firstOwner(data, fallback);
}

function targetFiles(data, fallback) {
  const files = asArray(data.target_files).filter(Boolean);
  return files.length ? files : [fallback].filter(Boolean);
}

function targetFilesFromIssue(issueData, data, fallback) {
  const files = asArray(issueData.target_files || issueData.target_file).filter(Boolean);
  return files.length ? files : targetFiles(data, fallback);
}

function issueProblem(issueData) {
  if (typeof issueData === 'string') return issueData;
  return String(issueData.problem || issueData.message || issueData.question || issueData.title || JSON.stringify(issueData));
}

function featureKeyFromTask(task) {
  const id = String(task?.id || '');
  const suffix = `-${task?.slug || ''}-round-${task?.round || ''}`;
  if (suffix !== '--round-' && id.endsWith(suffix)) return id.slice(0, -suffix.length);
  return id.split('-user-acceptance-round-')[0] || '';
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractSelfCheck(content) {
  const match = content.match(/(^|\n)##\s+Self Check\b[\s\S]*$/i);
  return match ? match[0] : '';
}

function findSelfCheckLine(content, pattern) {
  return String(content || '').split('\n').map((line) => line.trim()).find((line) => pattern.test(line)) || null;
}

export function parseSelfCheckConclusion(content) {
  for (const line of normalizedSelfCheckLines(content)) {
    const match = line.match(/(?:^|-?\s*)(?:结论|conclusion)\s*:\s*(pass|fail|blocked|changes_requested)/i);
    if (!match) continue;
    return normalizeConclusion(match[1]);
  }
  return null;
}

export function parseAllowsNextStage(content) {
  for (const line of normalizedSelfCheckLines(content)) {
    let match = line.match(/(?:^|-?\s*)(?:是否允许进入下一阶段|allows next stage)\s*:\s*(是|否|yes|no|true|false)/i);
    if (!match) match = line.match(/(?:^|-?\s*)allows_next_stage\s*:\s*(yes|no|true|false)/i);
    if (!match) continue;
    const value = match[1].toLowerCase();
    return value === '是' || value === 'yes' || value === 'true';
  }
  return null;
}

function normalizedSelfCheckLines(content) {
  return String(content || '')
    .split('\n')
    .map((line) => normalizeSelfCheckLine(line))
    .filter(Boolean);
}

function normalizeSelfCheckLine(line) {
  return String(line || '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrdReviewPhase(phase) {
  return ['INTAKE', 'PRODUCT_REVIEW', 'PRD_REVIEW'].includes(normalizePhase(phase));
}

function normalizePhase(value) {
  return String(value || 'INTAKE').trim().toUpperCase().replace(/[ -]/g, '_');
}
