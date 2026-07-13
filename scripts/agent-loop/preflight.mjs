import { spawnSync } from 'node:child_process';
import { evaluateM0Checkpoint, formatM0GuardCheck } from './m0-guard.mjs';
import { evaluateCurrentGateAllowlist } from './registered-gates.mjs';

export function runPreflight({
  repoRoot,
  requireTmux = true,
  requireWarp = false,
  requireCodex = true,
  requireOpenCode = false,
  enforceM0 = true,
  enforceGateAllowlist = true,
} = {}) {
  const checks = [checkCommand('git', ['--version'])];

  if (requireCodex) checks.push(checkCommand('codex', ['--version']));
  if (requireOpenCode) checks.push(checkCommand('opencode', ['--version']));
  if (requireTmux) checks.push(checkCommand('tmux', ['-V']));
  if (requireWarp) {
    checks.push(checkCommand('which', ['open'], 'open'));
    checks.push(checkWarpApp());
  }

  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, encoding: 'utf8' });
  checks.push({
    name: 'git-repository',
    ok: gitRoot.status === 0,
    detail: gitRoot.status === 0 ? gitRoot.stdout.trim() : gitRoot.stderr.trim(),
  });

  if (enforceGateAllowlist) {
    const gate = evaluateCurrentGateAllowlist({ repoRoot });
    checks.push({
      name: 'registered-gate-allowlist',
      ok: gate.ok,
      detail: gate.detail,
      data: gate,
    });
  }

  if (enforceM0) {
    const m0 = evaluateM0Checkpoint({ repoRoot });
    checks.push({
      name: 'm0-baseline-checkpoint',
      ok: m0.ok,
      detail: formatM0GuardCheck(m0),
      data: m0,
    });
  }

  const missing = checks.filter((check) => !check.ok);
  return { ok: missing.length === 0, checks, missing };
}

export function formatPreflight(preflight) {
  return preflight.checks
    .map((check) => `- ${check.name}: ${check.ok ? '正常' : '阻塞'}${check.detail ? `（${check.detail}）` : ''}`)
    .join('\n');
}

function checkCommand(name, args, label = name) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  return {
    name: label,
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || '').trim().split('\n')[0] || null,
  };
}

function checkWarpApp() {
  const result = spawnSync('open', ['-Ra', 'Warp'], { encoding: 'utf8' });
  return {
    name: 'warp-app',
    ok: result.status === 0,
    detail: result.status === 0 ? 'Warp.app' : (result.stderr || result.stdout || '').trim().split('\n')[0] || '未找到 Warp.app',
  };
}
