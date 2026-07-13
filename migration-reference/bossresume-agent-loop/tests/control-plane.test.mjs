import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkflowOutcome } from '../outcome-classifier.mjs';
import { buildWorkflowRecommendation } from '../recommendation.mjs';
import { parseSelfCheck } from '../self-check-parser.mjs';
import { validatePhaseSelfCheck } from '../self-check-policy.mjs';
import { validateGateResultContract } from '../gate-result-validator.mjs';

test('SYSTEM category has priority over human and auto issues', () => {
  const result = classifyWorkflowOutcome({
    issues: [
      { category: 'BUSINESS', decision_type: 'HUMAN_DECISION_REQUIRED', status: 'OPEN' },
      { category: 'SYSTEM', decision_type: 'AUTO_FIXABLE', failure_reason: 'verifier_inconsistent', status: 'OPEN' },
    ],
  });
  assert.equal(result.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(result.controllerStep, 'SYSTEM_FIX');
  assert.equal(result.canAutoContinue, false);
  assert.equal(result.canRequestUserDecision, false);
});

test('business human issue becomes NEEDS_USER', () => {
  const result = classifyWorkflowOutcome({
    issues: [{ category: 'BUSINESS', decision_type: 'HUMAN_DECISION_REQUIRED', status: 'OPEN' }],
  });
  assert.equal(result.workflowStatus, 'NEEDS_USER');
});

test('output contract issue remains auto fixable', () => {
  const result = classifyWorkflowOutcome({
    issues: [{ category: 'OUTPUT_CONTRACT', decision_type: 'AUTO_FIXABLE', status: 'OPEN' }],
  });
  assert.equal(result.workflowStatus, 'NEEDS_FIX');
});

test('repeated auto fix failure becomes system block, never NEEDS_USER', () => {
  const result = classifyWorkflowOutcome({
    failureCount: 3,
    maxFailureCount: 3,
    issues: [{ category: 'IMPLEMENTATION', decision_type: 'AUTO_FIXABLE', status: 'OPEN' }],
  });
  assert.equal(result.workflowStatus, 'BLOCKED_BY_SYSTEM');
  assert.equal(result.failureReason, 'repeated_auto_fix_failure');
});

test('system block recommendation never suggests next or decide', () => {
  const result = buildWorkflowRecommendation({ workflowStatus: 'BLOCKED_BY_SYSTEM', failureReason: 'worktree_input_missing' });
  assert.equal(result.command, null);
  assert.equal(result.action, 'FIX_SYSTEM');
});

for (const source of [
  '- **结论**：**PASS**\n- **是否允许进入下一阶段**：**是**',
  '结论: PASS\n是否允许进入下一阶段: true',
  'Conclusion: PASS\nAllows next stage: yes',
  'result: pass\nallows_next_stage: true',
]) {
  test(`self check parser accepts ${source.split('\n')[0]}`, () => {
    const result = parseSelfCheck(source);
    assert.equal(result.conclusion, 'PASS');
    assert.equal(result.allows_next_stage, true);
    assert.equal(result.parse_ok, true);
  });
}

test('PRD recheck does not use product intake policy', () => {
  const missing = validatePhaseSelfCheck({
    phase: 'INTAKE',
    content: '复查问题\n已关闭问题\n仍未关闭问题\n新增问题\n结论：PASS\n是否允许进入下一阶段：是',
  });
  assert.deepEqual(missing, []);
});

test('Gate verifier skips agent self check template', () => {
  const missing = validatePhaseSelfCheck({ phase: 'PRD_REVIEW', taskKind: 'GATE_VERIFY', content: '' });
  assert.deepEqual(missing, []);
});

test('PASS with OPEN issue is an output contract error', () => {
  const result = validateGateResultContract({
    conclusion: 'PASS',
    allows_next_stage: true,
    issues: [{ status: 'OPEN', decision_type: 'AUTO_FIXABLE' }],
  }, { ownerAgent: 'ui_agent', file: 'gate-result.json' });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].category, 'OUTPUT_CONTRACT');
  assert.equal(result.issues[0].kind, 'gate_result_pass_with_open_issues');
});
