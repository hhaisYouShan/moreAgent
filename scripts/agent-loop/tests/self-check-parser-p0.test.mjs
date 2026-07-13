import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSelfCheck, parseConclusion, parseBoolean } from '../self-check-parser.mjs';
import { classifyWorkflowOutcome } from '../outcome-classifier.mjs';
import { buildWorkflowRecommendation } from '../recommendation.mjs';

test('CHANGES_REQUESTED is a valid parsed conclusion, not a parser error', () => {
  assert.equal(parseConclusion('CHANGES_REQUESTED'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('NEEDS_FIX'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('需要修改'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('需修改'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('修改后复查'), 'CHANGES_REQUESTED');
});

test('CHANGES_REQUESTED with annotation is still a valid conclusion', () => {
  assert.equal(parseConclusion('CHANGES_REQUESTED（仍有问题）'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('NEEDS_FIX — still open'), 'CHANGES_REQUESTED');
  assert.equal(parseConclusion('修改后复查；存在问题'), 'CHANGES_REQUESTED');
});

test('Boolean with explanation is parsed correctly', () => {
  assert.equal(parseBoolean('否（需先修复问题）'), false);
  assert.equal(parseBoolean('是（对 frontend_agent 而言）'), true);
  assert.equal(parseBoolean('是 — 当前职责已完成'), true);
  assert.equal(parseBoolean('否，因为还有 BLOCKER'), false);
  assert.equal(parseBoolean('no, blockers remain'), false);
  assert.equal(parseBoolean('不允许；等待修复'), false);
});

test('Standard boolean values still work', () => {
  assert.equal(parseBoolean('是'), true);
  assert.equal(parseBoolean('否'), false);
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('false'), false);
  assert.equal(parseBoolean('允许'), true);
  assert.equal(parseBoolean('不允许'), false);
});

test('Self Check with CHANGES_REQUESTED and annotated boolean parses correctly', () => {
  const result = parseSelfCheck('结论：CHANGES_REQUESTED\n是否允许进入下一阶段：否（需先修复问题）');
  assert.equal(result.conclusion, 'CHANGES_REQUESTED');
  assert.equal(result.allows_next_stage, false);
  assert.equal(result.parse_ok, true);
});

test('Self Check with NEEDS_FIX and annotated yes parses correctly', () => {
  const result = parseSelfCheck('结论：NEEDS_FIX\n是否允许进入下一阶段：是 — 当前职责已完成');
  assert.equal(result.conclusion, 'CHANGES_REQUESTED');
  assert.equal(result.allows_next_stage, true);
  assert.equal(result.parse_ok, true);
});

test('SYSTEM + HUMAN together → BLOCKED_BY_SYSTEM (system takes priority)', () => {
  const result = classifyWorkflowOutcome({
    issues: [
      { category: 'SYSTEM', decision_type: 'AUTO_FIXABLE', failure_reason: 'self_check_parse_failed', status: 'OPEN' },
      { category: 'BUSINESS', decision_type: 'HUMAN_DECISION_REQUIRED', failure_reason: 'permission_model_undefined', status: 'OPEN' },
    ],
  });
  assert.equal(result.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(result.controllerStep, 'SYSTEM_FIX');
  assert.equal(result.failureReason, 'self_check_parse_failed');
  assert.equal(result.canRequestUserDecision, false);
});

test('SYSTEM + AUTO together → BLOCKED_BY_SYSTEM', () => {
  const result = classifyWorkflowOutcome({
    issues: [
      { category: 'SYSTEM', decision_type: 'AUTO_FIXABLE', failure_reason: 'worktree_input_missing', status: 'OPEN' },
      { category: 'IMPLEMENTATION', decision_type: 'AUTO_FIXABLE', status: 'OPEN' },
    ],
  });
  assert.equal(result.workflowStatus, 'BLOCKED_BY_SYSTEM');
});

test('HUMAN + AUTO together → NEEDS_USER', () => {
  const result = classifyWorkflowOutcome({
    issues: [
      { category: 'BUSINESS', decision_type: 'HUMAN_DECISION_REQUIRED', status: 'OPEN' },
      { category: 'IMPLEMENTATION', decision_type: 'AUTO_FIXABLE', status: 'OPEN' },
    ],
  });
  assert.equal(result.workflowStatus, 'NEEDS_USER');
});

test('Only AUTO issues → NEEDS_FIX', () => {
  const result = classifyWorkflowOutcome({
    issues: [
      { category: 'IMPLEMENTATION', decision_type: 'AUTO_FIXABLE', status: 'OPEN' },
    ],
  });
  assert.equal(result.workflowStatus, 'NEEDS_FIX');
});

test('No issues + PASS → READY', () => {
  const result = classifyWorkflowOutcome({
    gateResult: { status: 'APPROVED' },
    issues: [],
  });
  assert.equal(result.workflowStatus, 'READY');
});

test('BLOCKED_BY_SYSTEM recommendation has null command', () => {
  for (const reason of ['worktree_input_missing', 'self_check_parse_failed', 'verifier_inconsistent', 'engine_failed']) {
    const result = buildWorkflowRecommendation({ workflowStatus: 'BLOCKED_BY_SYSTEM', failureReason: reason });
    assert.equal(result.command, null);
    assert.equal(result.action, 'FIX_SYSTEM');
  }
});

test('Unknown format still returns null (parser error)', () => {
  assert.equal(parseConclusion('UNKNOWN_VALUE'), null);
  assert.equal(parseConclusion(''), null);
  assert.equal(parseBoolean('maybe'), null);
});
