import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedGateForPhase, validateGateResult } from '../src/contracts/gates.mjs';
import { createStructuredIssues } from '../src/contracts/issues.mjs';
import { validateSelfCheck } from '../src/contracts/self-check.mjs';

const gates = ['PRD_GATE', 'ARCHITECTURE_GATE', 'UI_GATE', 'DESIGN_GATE', 'TEST_GATE', 'PRODUCT_ACCEPTANCE_GATE', 'USER_ACCEPTANCE_GATE', 'ARCHIVE_GATE'];

test('validates only adapter-registered gates and rejects a mismatched gate result', () => {
  assert.equal(expectedGateForPhase({ phase: 'testing', phaseGateMap: { TESTING: 'TEST_GATE' } }), 'TEST_GATE');
  const result = validateGateResult({ result: { gateType: 'TECH_GATE', conclusion: 'PASS', allows_next_stage: true, issues: [] }, registeredGates: gates, expectedGate: 'TEST_GATE' });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.kind === 'gate_result_gate_type_unregistered'));
  assert.ok(result.issues.some((item) => item.kind === 'gate_result_gate_type_mismatch'));
});

test('requires a parseable self check and all configured requirements', () => {
  const check = validateSelfCheck({ content: '结论：PASS\n是否允许进入下一阶段：是\n覆盖：A', requiredPatterns: ['覆盖：A', '验证：B'] });
  assert.equal(check.parsed.parse_ok, true);
  assert.deepEqual(check.missingRequirements, ['验证：B']);
});

test('keeps an issue identity stable across repeated failures', () => {
  const first = createStructuredIssues({ gate: 'TEST_GATE', failures: [{ kind: 'missing_output', ownerAgent: 'test_agent', targetFiles: ['report.md'], message: 'missing' }] });
  const second = createStructuredIssues({ gate: 'TEST_GATE', failures: [{ kind: 'missing_output', ownerAgent: 'test_agent', targetFiles: ['report.md'], message: 'missing' }], previousIssues: first });
  assert.equal(second[0].issue_id, first[0].issue_id);
  assert.equal(second[0].repeat_count, 2);
});
