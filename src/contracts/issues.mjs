import { createHash } from 'node:crypto';

export function createStructuredIssues({ gate, failures = [], previousIssues = [] }) {
  const prior = new Map(previousIssues.map((item) => [item.decision_topic || item.issue_signature, item]));
  const unique = new Map();
  for (const failure of failures) {
    const owner = failure.owner_agent || failure.ownerAgent || 'gate_verifier';
    const targets = [...new Set(failure.target_files || failure.targetFiles || [])].sort();
    const decisionType = failure.decision_type || failure.decisionType || 'AUTO_FIXABLE';
    const topic = failure.decision_topic || failure.decisionTopic || `${failure.kind || failure.failure_reason}|${owner}|${targets.join(',')}`;
    const signature = digest(`${gate}|${topic}|${failure.failure_reason || failure.kind || 'unknown'}`);
    const previous = prior.get(topic) || prior.get(signature);
    unique.set(signature, { issue_id: previous?.issue_id || `ISSUE-${String(gate || 'GATE').replace(/[^A-Z0-9]/gi, '-')}-${signature.slice(0, 10)}`, issue_signature: signature, decision_topic: topic, repeat_count: Number(previous?.repeat_count || 0) + 1, repeated: Boolean(previous), gate, severity: failure.severity || 'MAJOR', category: failure.category || 'OUTPUT_CONTRACT', decision_type: decisionType, requires_user_decision: decisionType === 'HUMAN_DECISION_REQUIRED', failure_reason: failure.failure_reason || failure.kind || 'unknown', owner_agent: owner, target_files: targets, problem: failure.message || failure.problem || '', expected_fix: failure.expected_fix || failure.expectedFix || '', verification: failure.verification || '', status: 'OPEN' });
  }
  return [...unique.values()].map((issue, index) => ({ ...issue, display_index: index + 1 }));
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
