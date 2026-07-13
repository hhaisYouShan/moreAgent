import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function evaluateCheckpoint({ projectRoot, adapter, workflow }) {
  const policy = adapter.checkpoint;
  if (!policy) return { required: false, effectiveApproval: true, reasons: [] };
  const phase = String(workflow?.phase || '').toUpperCase();
  if (!policy.requiredPhases.map((value) => String(value).toUpperCase()).includes(phase)) return { required: false, effectiveApproval: true, reasons: [] };
  const relativePath = policy.resultPath;
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) return { required: true, effectiveApproval: false, resultPath: relativePath, reasons: ['checkpoint_result_missing'] };
  let result = null;
  try { result = JSON.parse(await readFile(absolutePath, 'utf8')); } catch { return { required: true, effectiveApproval: false, resultPath: relativePath, reasons: ['checkpoint_result_invalid_json'] }; }
  const reasons = [];
  if (result?.[policy.statusField || 'status'] !== (policy.approvedValue || 'APPROVED')) reasons.push('checkpoint_not_approved');
  for (const field of policy.requiredFields || []) if (result?.[field] === null || result?.[field] === undefined || result?.[field] === '') reasons.push(`checkpoint_missing_${field}`);
  return { required: true, effectiveApproval: reasons.length === 0, resultPath: relativePath, reasons };
}
