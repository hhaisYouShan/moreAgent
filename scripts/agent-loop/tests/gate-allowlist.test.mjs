import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  REGISTERED_GATE_TYPES,
  evaluateCurrentGateAllowlist,
} from '../registered-gates.mjs';
import { validateGateResultContract } from '../gate-result-validator.mjs';

function passingGateResult(gateType) {
  return {
    gateType,
    conclusion: 'PASS',
    allows_next_stage: true,
    issues: [],
    open_issue_count: 0,
  };
}

async function writeWorkflow(root, value) {
  const target = path.join(root, 'agent-loop-docs/process/workflow-state.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('all eight registered gate types pass Gate Result validation', () => {
  for (const gate of REGISTERED_GATE_TYPES) {
    const result = validateGateResultContract(passingGateResult(gate), {
      ownerAgent: 'gate_verifier',
      file: 'gate_result.json',
      expectedGate: gate,
    });
    assert.equal(result.valid, true, `${gate}: ${JSON.stringify(result.issues)}`);
  }
});

test('TECH_GATE is rejected as an active Gate Result type', () => {
  const result = validateGateResultContract(passingGateResult('TECH_GATE'), {
    ownerAgent: 'gate_verifier',
    file: 'gate_result.json',
    expectedGate: 'TECH_GATE',
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.kind === 'gate_result_gate_type_unregistered'));
  assert.ok(result.issues.every((item) => item.category === 'SYSTEM'));
});

test('Gate Result cannot declare a different registered gate than Workflow', () => {
  const result = validateGateResultContract(passingGateResult('TEST_GATE'), {
    ownerAgent: 'gate_verifier',
    file: 'gate_result.json',
    expectedGate: 'DESIGN_GATE',
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.kind === 'gate_result_gate_type_mismatch'));
});

test('NONE is allowed only for INTAKE', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gate-allowlist-none-'));
  await writeWorkflow(root, { phase: 'INTAKE', gate: 'NONE' });
  assert.equal(evaluateCurrentGateAllowlist({ repoRoot: root }).ok, true);

  await writeWorkflow(root, { phase: 'DESIGN_REVIEW', gate: 'NONE' });
  const rejected = evaluateCurrentGateAllowlist({ repoRoot: root });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.reasons.some((item) => item.startsWith('none_gate_not_allowed_for_phase')));
});

test('Workflow TECH_GATE is rejected before Agent execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gate-allowlist-tech-'));
  await writeWorkflow(root, { phase: 'DESIGN_REVIEW', gate: 'TECH_GATE' });
  const result = evaluateCurrentGateAllowlist({ repoRoot: root });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('gate_type_unregistered:TECH_GATE'));
  assert.ok(result.reasons.some((item) => item.includes('expected=DESIGN_GATE')));
});
