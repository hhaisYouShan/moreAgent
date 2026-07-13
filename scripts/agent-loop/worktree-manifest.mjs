import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function buildTaskInputManifest({
  task,
  workspaceRoot,
  featureKey,
  workflowRound,
  inputs = [],
  requiredOutputs = [],
  mainWorkspaceRoot = null,
} = {}) {
  if (!task?.id) throw new Error('task.id is required');
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const normalizedInputs = [];
  for (const input of inputs) {
    const relativePath = normalizeRelativePath(input.path);
    const absolutePath = path.join(workspaceRoot, relativePath);
    normalizedInputs.push({
      type: input.type || null,
      path: relativePath,
      required: input.required !== false,
      sha256: existsSync(absolutePath) ? await sha256File(absolutePath) : null,
    });
  }

  return {
    schema_version: '1.0',
    task_id: task.id,
    task_kind: task.taskKind || task.task_kind || task.kind || null,
    agent: task.agent || null,
    feature_key: featureKey || null,
    workflow_round: Number(workflowRound ?? task.round ?? 0),
    workspace_root: workspaceRoot,
    inputs: normalizedInputs,
    required_outputs: requiredOutputs.map(normalizeRelativePath),
    forbidden_roots: mainWorkspaceRoot ? [mainWorkspaceRoot] : [],
    missing_input_behavior: 'BLOCKED_BY_SYSTEM',
  };
}

export async function validateTaskInputManifest(manifest, { workspaceRoot = manifest?.workspace_root } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return invalid('worktree_manifest_invalid', ['Manifest must be a JSON object.']);
  }
  if (!workspaceRoot) errors.push('workspace_root is required.');
  if (!manifest.task_id) errors.push('task_id is required.');
  if (!manifest.feature_key) errors.push('feature_key is required.');
  if (!Number.isInteger(Number(manifest.workflow_round))) errors.push('workflow_round must be an integer.');

  for (const input of Array.isArray(manifest.inputs) ? manifest.inputs : []) {
    const relativePath = normalizeRelativePath(input.path);
    const absolutePath = path.resolve(workspaceRoot || '.', relativePath);
    if (!isInsideRoot(absolutePath, path.resolve(workspaceRoot || '.'))) {
      errors.push(`Input escapes worktree: ${relativePath}`);
      continue;
    }
    if (input.required !== false && !existsSync(absolutePath)) {
      errors.push(`Required input missing: ${relativePath}`);
      continue;
    }
    if (existsSync(absolutePath) && input.sha256) {
      const actualHash = await sha256File(absolutePath);
      if (actualHash !== input.sha256) errors.push(`Input hash mismatch: ${relativePath}`);
    }
  }

  if (errors.length > 0) return invalid(classifyManifestFailure(errors), errors);
  return { valid: true, category: null, failure_reason: null, errors: [] };
}

export function worktreePromptRules(manifestPath = 'task-input-manifest.json') {
  return [
    `先读取 ${manifestPath}，只使用其中声明的输入。`,
    '只能读取当前 worktree 内的文件。',
    '禁止主动读取主仓库绝对路径或寻找其他 PRD 副本。',
    '如果必需输入缺失或 hash 不一致，输出 INPUT_MISSING 并停止，不得绕回主工作区。',
    '不要遍历全部历史 review、gate-result、issues 或 audit-events；优先使用 Task Context Package。',
  ].join('\n');
}

function invalid(failureReason, errors) {
  return {
    valid: false,
    category: 'SYSTEM',
    decision_type: 'AUTO_FIXABLE',
    requires_user_decision: false,
    workflow_status: 'BLOCKED_BY_SYSTEM',
    controller_step: 'SYSTEM_FIX',
    failure_reason: failureReason,
    errors,
  };
}

function classifyManifestFailure(errors) {
  if (errors.some((item) => item.includes('hash mismatch'))) return 'worktree_input_hash_mismatch';
  if (errors.some((item) => item.includes('missing'))) return 'worktree_input_missing';
  return 'worktree_manifest_invalid';
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Input path must be relative and stay inside the worktree: ${value}`);
  }
  return normalized;
}

function isInsideRoot(absolutePath, rootPath) {
  const relative = path.relative(rootPath, absolutePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}
