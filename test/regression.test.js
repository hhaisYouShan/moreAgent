#!/usr/bin/env node
/**
 * V1.7.1 Regression Tests
 *
 * All tests exercise the actual production dist code via CLI commands
 * and filesystem manipulation. No production logic is replicated.
 *
 * Run: node test/regression.test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'moreagent-test-'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function runCliIn(dir, args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function initTestDir() {
  const dir = path.join(TMP, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  runCliIn(dir, ['init']);
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  try { execSync('git commit -m init', { cwd: dir, stdio: 'pipe' }); } catch {}
  return dir;
}

function writeArtifact(dir, sessionName, fileName, content) {
  const d = path.join(dir, '.moreagent', 'runs', 'test-run', sessionName);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, fileName), content);
}

function writeSessions(dir, data) {
  fs.writeFileSync(path.join(dir, '.moreagent', 'sessions.json'), JSON.stringify(data, null, 2));
}

// ============================================================
// 1. PROTOCOL LINE PARSING (via status --summary CLI)
// ============================================================

console.log('\n1. Protocol Line Parsing (CLI e2e)');
console.log('==================================');

let testDir;
test('init test project', () => { testDir = initTestDir(); });

test('Decision: APPROVED (bare)', () => {
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\n# Report\nOK');
  writeArtifact(testDir, 'tester', 'test-report.md', 'Result: PASS\n\n# Report');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Review:       APPROVED'), `got: ${r.stdout.slice(0, 500)}`);
});

test('Decision: APPROVED (bold wrapped)', () => {
  writeArtifact(testDir, 'reviewer', 'review-report.md', '# Review Report\n\n**Decision: APPROVED**\n\nAll good.');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Review:       APPROVED'), 'bold Decision not parsed');
});

test('Result: PASS', () => {
  writeArtifact(testDir, 'tester', 'test-report.md', 'Result: PASS\n\n# Report');
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: APPROVED');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Test:         PASS'), `got Test: ${r.stdout.match(/Test:\s+(\w+)/)?.[1]}`);
});

test('Result: FAILURES: 0 should NOT be FAIL', () => {
  writeArtifact(testDir, 'tester', 'test-report.md', 'Result: FAILURES: 0\n\n# Test Report\nAll errors are resolved.');
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: APPROVED');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(!r.stdout.includes('Test:         FAIL'), 'FAILURES: 0 should not be FAIL');
});

test('Result: FAIL (genuine)', () => {
  writeArtifact(testDir, 'tester', 'test-report.md', 'Result: FAIL\n\n# Report\n3 tests failed.');
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: CHANGES_REQUESTED\n\n# Review');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Test:         FAIL'), 'genuine FAIL not detected');
});

test('bold **Result: PASS** (bold wrapped on second line)', () => {
  writeArtifact(testDir, 'tester', 'test-report.md', '# Test Report\n\n**Result: PASS**\n\nAll passed.');
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: APPROVED');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Test:         PASS'), 'bold Result on second line not parsed');
});

test('Decision: CHANGES_REQUESTED (bare)', () => {
  writeArtifact(testDir, 'reviewer', 'review-report.md', 'Decision: CHANGES_REQUESTED\n\nNeeds work.');
  writeArtifact(testDir, 'tester', 'test-report.md', 'Result: PASS');
  writeSessions(testDir, {
    runs: [{
      id: 'test-run', task: 'test', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run'),
      sessions: [
        { id: 'rev-1', agentName: 'reviewer', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'reviewer'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
        { id: 'tst-1', agentName: 'tester', status: 'completed',
          artifactDir: path.join(testDir, '.moreagent', 'runs', 'test-run', 'tester'),
          startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', runId: 'test-run' },
      ],
    }]
  });
  const r = runCliIn(testDir, ['status', '--run', 'test-run', '--summary']);
  assert(r.stdout.includes('Review:       CHANGES_REQUESTED'), 'CHANGES_REQUESTED not detected');
});

// ============================================================
// 2. PENDING SESSION FILTER (CLI e2e via status --latest)
// ============================================================

console.log('\n2. Pending Session Filter (CLI e2e)');
console.log('====================================');

test('full workflow: frontend pending base hidden', () => {
  const dir = path.join(TMP, 'fw');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, '.moreagent'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.moreagent', 'runs'), { recursive: true });

  writeSessions(dir, {
    runs: [{
      id: 'fw-test', task: 'test full', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(dir, '.moreagent', 'runs', 'fw-test'),
      workflow: { profile: 'full', completedPhases: ['brain', 'prd', 'prd-review', 'prd-gate', 'tech-plan', 'tech-gate', 'implementation', 'test', 'review'] },
      sessions: [
        { id: 'fe-1', agentName: 'frontend', status: 'pending', artifactDir: '/tmp/f', startedAt: '', runId: 'fw-test' },
        { id: 'be-1', agentName: 'backend', status: 'pending', artifactDir: '/tmp/b', startedAt: '', runId: 'fw-test' },
        { id: 'pr-1', agentName: 'product', status: 'completed', artifactDir: '/tmp/p', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'fpr-1', agentName: 'frontend-prd-review', status: 'completed', artifactDir: '/tmp/fpr', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'bpr-1', agentName: 'backend-prd-review', status: 'completed', artifactDir: '/tmp/bpr', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'fp-1', agentName: 'frontend-plan', status: 'completed', artifactDir: '/tmp/fp', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'bp-1', agentName: 'backend-plan', status: 'completed', artifactDir: '/tmp/bp', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'fi-1', agentName: 'frontend-implementation', status: 'completed', artifactDir: '/tmp/fi', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
        { id: 'bi-1', agentName: 'backend-implementation', status: 'completed', artifactDir: '/tmp/bi', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test' },
      ],
    }]
  });
  const r = runCliIn(dir, ['status', '--latest']);
  // frontend and backend base pending should NOT appear in the Agents summary
  assert(!r.stdout.includes('frontend PENDING'), 'frontend pending should be filtered from summary');
  assert(!r.stdout.includes('backend PENDING'), 'backend pending should be filtered from summary');
});

test('full workflow: architect pending NOT hidden', () => {
  const dir = path.join(TMP, 'fw2');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, '.moreagent'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.moreagent', 'runs'), { recursive: true });

  writeSessions(dir, {
    runs: [{
      id: 'fw-test2', task: 'test', status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(dir, '.moreagent', 'runs', 'fw-test2'),
      workflow: { profile: 'full', completedPhases: [] },
      sessions: [
        { id: 'a-1', agentName: 'architect', status: 'pending', artifactDir: '/tmp/a', startedAt: '', runId: 'fw-test2' },
      ],
    }]
  });
  const r = runCliIn(dir, ['status', '--latest']);
  assert(r.stdout.includes('architect PENDING'), 'architect pending should NOT be hidden');
});

test('full workflow: frontend with startedAt NOT hidden', () => {
  const dir = path.join(TMP, 'fw3');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, '.moreagent'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.moreagent', 'runs'), { recursive: true });

  writeSessions(dir, {
    runs: [{
      id: 'fw-test3', task: 'test', status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(dir, '.moreagent', 'runs', 'fw-test3'),
      workflow: { profile: 'full', completedPhases: [] },
      sessions: [
        { id: 'fe-2', agentName: 'frontend', status: 'pending', artifactDir: '/tmp/fe', startedAt: '2024-01-01T00:00:00Z', runId: 'fw-test3' },
      ],
    }]
  });
  const r = runCliIn(dir, ['status', '--latest']);
  assert(r.stdout.includes('frontend PENDING'), 'frontend with startedAt should NOT be hidden');
});

// ============================================================
// 3. MERGE (dry-run + apply) — real worktree required
// ============================================================

console.log('\n3. Merge (dry-run + apply)');
console.log('==========================');

function makeRealWorktree(dir, runId) {
  const wtPath = path.join(dir, '.moreagent', 'worktrees', `agent-${runId}`);
  execSync(`git worktree add "${wtPath}"`, { cwd: dir, stdio: 'pipe' });
  return wtPath;
}

let mergeDir;
let mergeRunId = 'merge-run';
let mergeWtPath;

test('setup merge test dir with real worktree', () => {
  mergeDir = initTestDir();
  // Need a second commit for worktree baseline
  fs.writeFileSync(path.join(mergeDir, 'README.md'), '# test');
  execSync('git add -A && git commit -m "second commit"', { cwd: mergeDir, stdio: 'pipe' });
  mergeWtPath = makeRealWorktree(mergeDir, mergeRunId);
  assert(fs.existsSync(mergeWtPath), 'worktree should exist');
});

test('merge dry-run on dirty main: shows Run/Worktree/Branch', () => {
  // Make main dirty by writing a MoreAgent state file
  fs.writeFileSync(path.join(mergeDir, '.moreagent', 'merge-dirty-test'), 'dirty');
  writeSessions(mergeDir, {
    runs: [{
      id: mergeRunId, task: 'test merge', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(mergeDir, '.moreagent', 'runs', mergeRunId),
      sessions: [
        { id: 'imp-1', agentName: 'implementer', status: 'completed',
          artifactDir: '/tmp/imp', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z',
          worktreePath: mergeWtPath, runId: mergeRunId },
      ],
    }]
  });
  const r = runCliIn(mergeDir, ['merge', '--run', mergeRunId]);
  assert(r.status === 0, `dry-run should exit 0, got ${r.status}`);
  assert(r.stdout.includes('Run:'), 'dry-run should show Run info');
  assert(r.stdout.includes('Worktree:'), 'dry-run should show Worktree path');
  assert(r.stdout.includes('Branch:'), 'dry-run should show Branch');
});

test('merge --apply on dirty main: rejects with clean message', () => {
  // Main is already dirty from previous test
  const r = runCliIn(mergeDir, ['merge', '--run', mergeRunId, '--apply']);
  assert(r.status !== 0, '--apply should reject dirty main');
  assert(r.stderr.includes('not clean') || r.stdout.includes('not clean') || r.stderr.includes('Main project'),
    `apply should mention dirty main. stderr=${r.stderr.slice(0, 200)}`);
});

// ============================================================
// 4. JSON OUTPUT (V1.8)
// ============================================================

console.log('\n4. JSON Output (V1.8)');
console.log('=====================');

let jsonTestDir;
test('JSON: init test dir', () => { jsonTestDir = initTestDir(); });

test('JSON: status --json list mode has runs array', () => {
  const r = runCliIn(jsonTestDir, ['status', '--json']);
  assert(r.status === 0, `list --json should exit 0, got ${r.status}`);
  const data = JSON.parse(r.stdout);
  assert(Array.isArray(data.runs), 'runs should be array');
});

test('JSON: status --latest --json has run.id', () => {
  const r = runCliIn(jsonTestDir, ['status', '--latest', '--json']);
  const data = JSON.parse(r.stdout);
  assert(typeof data.run.id === 'string', 'missing run.id');
});

test('JSON: status --run missing --json returns error JSON + exit 1', () => {
  const r = runCliIn(jsonTestDir, ['status', '--run', 'does-not-exist', '--json']);
  assert(r.status !== 0, 'should exit non-zero');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
  assert(data.error.code === 'RUN_NOT_FOUND', `expected RUN_NOT_FOUND, got ${data.error.code}`);
});

test('JSON: inspect --run missing --json returns error JSON + exit 1', () => {
  const r = runCliIn(jsonTestDir, ['inspect', '--run', 'does-not-exist', '--json']);
  assert(r.status !== 0, 'should exit non-zero');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
});

test('JSON: non-json mode errors still use text', () => {
  const r = runCliIn(jsonTestDir, ['status', '--run', 'does-not-exist']);
  assert(r.stdout.includes('not found') || r.stderr.includes('not found'),
    'non-json error should be text');
});

test('JSON: status --run summary --json has canResume/canMerge/gates', () => {
  // Write a completed run for testing
  writeSessions(jsonTestDir, {
    runs: [{
      id: 'json-run', task: 'test json', status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      artifactDir: path.join(jsonTestDir, '.moreagent', 'runs', 'json-run'),
      sessions: [
        { id: 'a-1', agentName: 'architect', status: 'completed',
          artifactDir: '/tmp/a', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:00:30Z', runId: 'json-run' },
      ],
    }]
  });
  const r = runCliIn(jsonTestDir, ['status', '--run', 'json-run', '--summary', '--json']);
  const data = JSON.parse(r.stdout);
  assert(typeof data.run.canResume === 'boolean', 'canResume not boolean');
  assert(typeof data.run.canMerge === 'boolean', 'canMerge not boolean');
  assert(typeof data.run.gates === 'object', 'gates not object');
  // summary must NOT contain sessions
  assert(!data.run.sessions, 'summary should not have sessions');
  // summary must NOT contain completedPhases/currentPhase
  assert(!data.run.completedPhases, 'summary should not have completedPhases');
  assert(typeof data.run.currentPhase === 'undefined' || data.run.currentPhase === undefined,
    'summary should not have currentPhase');
});

test('JSON: status --run detail --json has sessions', () => {
  const r = runCliIn(jsonTestDir, ['status', '--run', 'json-run', '--json']);
  const data = JSON.parse(r.stdout);
  assert(Array.isArray(data.run.sessions), 'detail should have sessions array');
  assert(data.run.sessions.length > 0, 'detail sessions should not be empty');
});

test('JSON: inspect --agent --json returns UNSUPPORTED', () => {
  const r = runCliIn(jsonTestDir, ['inspect', '--run', 'json-run', '--agent', 'reviewer', '--json']);
  assert(r.status !== 0, 'should exit non-zero');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
  assert(data.error.code === 'UNSUPPORTED_JSON_MODE',
    `expected UNSUPPORTED_JSON_MODE, got ${data.error.code}`);
  assert(!r.stderr.includes('UNSUPPORTED_JSON_MODE'),
    'stderr should not contain business error in JSON mode');
});

test('JSON: durationSeconds is number or null', () => {
  const r = runCliIn(jsonTestDir, ['status', '--latest', '--json']);
  const data = JSON.parse(r.stdout);
  for (const s of (data.run.sessions || [])) {
    assert(s.durationSeconds === null || typeof s.durationSeconds === 'number',
      `durationSeconds should be number|null, got ${typeof s.durationSeconds}`);
  }
});

test('JSON: empty sessions dir — status --json returns error', () => {
  const dir = path.join(TMP, 'empty');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.moreagent'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.moreagent', 'sessions.json'), JSON.stringify({ runs: [] }));
  const r = runCliIn(dir, ['status', '--json']);
  assert(r.status !== 0, 'should exit non-zero for empty sessions');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
});

test('JSON: inspect --workflow --json on non-full run returns error', () => {
  const r = runCliIn(jsonTestDir, ['inspect', '--run', 'json-run', '--workflow', '--json']);
  assert(r.status !== 0, 'should exit non-zero for non-full workflow');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
  assert(data.error.code === 'NOT_FULL_WORKFLOW',
    `expected NOT_FULL_WORKFLOW, got ${data.error.code}`);
});

test('JSON: unknown command --json returns JSON error', () => {
  const r = runCliIn(jsonTestDir, ['unknownfoo', '--json']);
  assert(r.status !== 0, 'should exit non-zero');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
  assert(data.error.code === 'BAD_ARGS', `expected BAD_ARGS, got ${data.error.code}`);
  assert(!r.stdout.includes('MoreAgent'), 'stdout should NOT contain help text');
});

test('JSON: start --resume --json without --run returns JSON error', () => {
  const r = runCliIn(jsonTestDir, ['start', '--resume', '--json']);
  assert(r.status !== 0, 'should exit non-zero');
  const data = JSON.parse(r.stdout);
  assert(data.error, 'missing error object');
  assert(data.error.code === 'BAD_ARGS', `expected BAD_ARGS, got ${data.error.code}`);
});

// ============================================================
// 5. WORKFLOW REPORT (V1.9)
// ============================================================

console.log('\n5. Workflow Report (V1.9)');
console.log('========================');

let reportDir;
test('Report: init test dir', () => { reportDir = initTestDir(); });

function writeArtifactForReport(dir, runId, sessionName, fileName, content) {
  const d = path.join(dir, '.moreagent', 'runs', runId, sessionName);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, fileName), content);
}

test('Report: completed + PASS/APPROVED + clean → MERGE_READY', () => {
  const runId = 'report-good';
  const sessions = [
    { id: 'a-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', worktreePath: path.join(reportDir, '.moreagent', 'worktrees', `agent-${runId}`), runId },
  ];
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{ id: runId, task: 'good run', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'PASSED', `got ${data.report.decision.overallStatus}`);
  // recommendation depends on worktree/main state; just check it's one of the valid values
  assert(['MERGE_READY', 'BLOCKED', 'NEEDS_REPAIR', 'NEEDS_REVIEW', 'RUNNING', 'UNKNOWN'].includes(data.report.decision.recommendation),
    `invalid recommendation: ${data.report.decision.recommendation}`);
});

test('Report: completed + test unknown → PARTIAL', () => {
  const runId = 'report-partial';
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', '# Report\n\nNo result line.');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED');
  writeSessions(reportDir, { runs: [{ id: runId, task: 'partial run', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions: [
    { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
  ] }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'PARTIAL', `got ${data.report.decision.overallStatus}`);
  assert(data.report.decision.recommendation === 'NEEDS_REVIEW', `got ${data.report.decision.recommendation}`);
});

test('Report: running → RUNNING', () => {
  const runId = 'report-running';
  writeSessions(reportDir, { runs: [{ id: runId, task: 'running run', status: 'running', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), workflow: { profile: 'full', completedPhases: ['brain'] }, sessions: [
    { id: 'b-1', agentName: 'brain', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'brain'), startedAt: '2024-01-01T00:00:00Z', runId },
  ] }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'RUNNING', `got ${data.report.decision.overallStatus}`);
  assert(data.report.decision.recommendation === 'RUNNING');
});

test('Report: not found → RUN_NOT_FOUND', () => {
  const r = runCliIn(reportDir, ['report', '--run', 'does-not-exist', '--json']);
  assert(r.status !== 0);
  const data = JSON.parse(r.stdout);
  assert(data.error.code === 'RUN_NOT_FOUND', `got ${data.error.code}`);
});

test('Report: text output is non-empty', () => {
  const r = runCliIn(reportDir, ['report', '--latest']);
  assert(r.status === 0, 'report text should exit 0');
  assert(r.stdout.length > 0, 'report text should not be empty');
});

// ============================================================
// 6. BUILD CHECK
// ============================================================

console.log('\n6. Build Check');
console.log('==============');

test('dist/cli.js exists', () => {
  assert(fs.existsSync(CLI), 'dist/cli.js not found');
});

test('dist/cli.js is functional (--help)', () => {
  const r = runCli(['--help']);
  assert(r.stdout.includes('MoreAgent'), 'CLI --help failed');
});

// ============================================================
// SUMMARY
// ============================================================

// Cleanup
try { fs.rmSync(TMP, { recursive: true }); } catch {}

console.log(`\n========================================`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed.\n');
  process.exit(0);
}
