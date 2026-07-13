import { spawnSync } from 'node:child_process';

const BUSINESS_CODE_PREFIXES = ['client/', 'server/', 'tests/', 'e2e/'];

export function collectScopeViolations({ tasks, worktrees }) {
  const violations = new Map();

  for (const task of tasks) {
    const worktree = worktrees.get(task.id);
    if (!worktree) {
      violations.set(task.id, []);
      continue;
    }

    const preloaded = new Set(task.preloadedFiles || []);
    const changedFiles = gitChangedFiles(worktree.worktreePath);

    if (task.allowCodeChanges) {
      const disallowed = changedFiles.filter((file) => isDisallowedAllowedTaskChange({ file, task, preloaded }));
      violations.set(task.id, disallowed);
      continue;
    }

    const disallowed = changedFiles.filter((file) => isBusinessCode(file) && !preloaded.has(file));
    violations.set(task.id, disallowed);
  }

  return violations;
}

function isDisallowedAllowedTaskChange({ file, task, preloaded }) {
  if (preloaded.has(file)) return false;
  if (isAgentLoopDoc(file)) return false;

  // Frontend/backend/repair implementation tasks can modify business code according to their phase contract.
  if (task.agent !== 'test_agent') return false;

  // Test Agent uses allowedChangePatterns for glob-style authorization.
  // editableFiles is reserved for concrete files that must exist in the worktree.
  const allowedPatterns = task.allowedChangePatterns || [];
  return !matchesAnyEditablePattern(file, allowedPatterns);
}

function matchesAnyEditablePattern(file, patterns) {
  return patterns.some((pattern) => matchesEditablePattern(file, pattern));
}

function matchesEditablePattern(file, pattern) {
  const value = String(file || '');
  switch (pattern) {
    case 'client/**/*.test.*': return value.startsWith('client/') && value.includes('.test.');
    case 'client/**/*.spec.*': return value.startsWith('client/') && value.includes('.spec.');
    case 'server/**/*.test.*': return value.startsWith('server/') && value.includes('.test.');
    case 'server/**/*.spec.*': return value.startsWith('server/') && value.includes('.spec.');
    case 'tests/**': return value.startsWith('tests/');
    case 'e2e/**': return value.startsWith('e2e/');
    case 'playwright.config.*': return value.startsWith('playwright.config.');
    case 'vitest.config.*': return value.startsWith('vitest.config.');
    case 'jest.config.*': return value.startsWith('jest.config.');
    default: return value === pattern;
  }
}

function isBusinessCode(file) {
  return BUSINESS_CODE_PREFIXES.some((prefix) => String(file || '').startsWith(prefix));
}

function isAgentLoopDoc(file) {
  return String(file || '').startsWith('agent-loop-docs/');
}

function gitChangedFiles(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawFile = line.slice(3).trim();
      return rawFile.includes(' -> ') ? rawFile.split(' -> ').pop().trim() : rawFile;
    })
    .filter(Boolean);
}
