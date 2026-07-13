#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { formatBeijingRunId, formatBeijingTimestamp } from './time.mjs';

const repoRoot = process.cwd();
const runId = formatBeijingRunId(new Date());

main().catch((error) => {
  console.error('[agent-checkpoint] failed');
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  const files = changedFiles();
  const manifestPath = path.join(repoRoot, 'agent-loop-docs/process/sync-manifest.json');
  const snapshotDir = path.join(repoRoot, '.agent-runs', 'snapshots', runId);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await mkdir(snapshotDir, { recursive: true });

  const manifest = {
    run_id: runId,
    created_at: formatBeijingTimestamp(),
    changed_files: files,
    agent_loop_files: files.filter((file) => file.startsWith('agent-loop-docs/') || file.startsWith('.agent-runs/')),
    prd_files: files.filter((file) => file.startsWith('docs/prd/')),
    code_files: files.filter((file) => file.startsWith('client/') || file.startsWith('server/')),
    recommendation: 'Review this manifest, then commit or stash the listed files before creating new worktrees or switching machines.',
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('[agent-checkpoint] 已生成同步清单');
  console.log(`- manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log(`- changed files: ${files.length}`);
  if (files.length) {
    console.log('[agent-checkpoint] 建议提交：');
    console.log('  git add agent-loop-docs docs/prd .opencode scripts/agent-loop package.json');
    console.log(`  git commit -m "agent-loop checkpoint: ${runId}"`);
  }
}

function changedFiles() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((file) => file.includes(' -> ') ? file.split(' -> ').pop().trim() : file)
    .filter(Boolean);
}
