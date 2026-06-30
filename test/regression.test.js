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
let reportWtPath;

test('Report: init test dir with real worktree', () => {
  reportDir = initTestDir();
  // Create a second commit for worktree baseline
  fs.writeFileSync(path.join(reportDir, 'README.md'), '# test');
  execSync('git add -A && git commit -m "second" --allow-empty', { cwd: reportDir, stdio: 'pipe' });
  // Create a real worktree
  reportWtPath = path.join(reportDir, '.moreagent', 'worktrees', 'agent-rpt-wt');
  execSync(`git worktree add "${reportWtPath}"`, { cwd: reportDir, stdio: 'pipe' });
  assert(fs.existsSync(reportWtPath), 'report worktree should exist');
});

function writeArtifactForReport(dir, runId, sessionName, fileName, content) {
  const d = path.join(dir, '.moreagent', 'runs', runId, sessionName);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, fileName), content);
}

test('Report: MERGE_READY (PASS/APPROVED + real worktree)', () => {
  const runId = 'report-merge-ready';
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{ id: runId, task: 'merge ready', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions: [
    { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:00:30Z', runId },
    { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:00:30Z', worktreePath: reportWtPath, runId },
  ] }] });

  execSync('git add -A && git commit -m "merge-ready test data"', { cwd: reportDir, stdio: 'pipe' });

  const st = execSync('git status --porcelain', { cwd: reportDir, encoding: 'utf-8' }).trim();
  assert(st === '', `main should be clean before MERGE_READY report, got ${st}`);

  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'PASSED', `got ${data.report.decision.overallStatus}`);
  assert(data.report.decision.recommendation === 'MERGE_READY', `got ${data.report.decision.recommendation}`);
  assert(data.report.merge.canMerge === true, 'canMerge should be true');
  assert(data.report.merge.mainClean === true, 'mainClean should be true');
  assert(data.report.worktree.exists === true, 'worktree should exist');
});

test('Report: BLOCKED (PASS/APPROVED + real worktree + main dirty)', () => {
  const runId = 'report-blocked';
  // Make main dirty
  fs.writeFileSync(path.join(reportDir, '.moreagent', 'dirty-marker'), 'x');
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{ id: runId, task: 'blocked run', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions: [
    { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', worktreePath: reportWtPath, runId },
  ] }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'PASSED', `got ${data.report.decision.overallStatus}`);
  assert(data.report.decision.recommendation === 'BLOCKED', `got ${data.report.decision.recommendation}`);
  assert(data.report.merge.mainClean === false, 'mainClean should be false');
  // Clean up
  try { fs.unlinkSync(path.join(reportDir, '.moreagent', 'dirty-marker')); } catch {}
});

test('Report: NEEDS_REPAIR (failed + canResume)', () => {
  const runId = 'report-needs-repair';
  writeSessions(reportDir, { runs: [{ id: runId, task: 'repair run', status: 'failed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), workflow: { profile: 'full', completedPhases: ['brain', 'prd', 'prd-review'], failedPhase: 'prd-gate' }, sessions: [
    { id: 'b-1', agentName: 'brain', status: 'completed', artifactDir: '/tmp/b', startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'p-1', agentName: 'product', status: 'completed', artifactDir: '/tmp/p', startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'fpr-1', agentName: 'frontend-prd-review', status: 'completed', artifactDir: '/tmp/fpr', startedAt: '2024-01-01T00:00:00Z', runId },
  ] }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'FAILED', `got ${data.report.decision.overallStatus}`);
  assert(data.report.decision.canResume === true, 'canResume should be true');
  assert(data.report.decision.recommendation === 'NEEDS_REPAIR', `got ${data.report.decision.recommendation}`);
});

test('Report: repair sessions counted', () => {
  const runId = 'report-repair-rounds';
  writeSessions(reportDir, { runs: [{ id: runId, task: 'repair run', status: 'failed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions: [
    { id: 'r1-1', agentName: 'repair-1-implementer', status: 'completed', artifactDir: '/tmp/r1', startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'r1-2', agentName: 'repair-1-tester', status: 'completed', artifactDir: '/tmp/r2', startedAt: '2024-01-01T00:00:00Z', runId },
    { id: 'r2-1', agentName: 'repair-2-implementer', status: 'completed', artifactDir: '/tmp/r3', startedAt: '2024-01-01T00:00:00Z', runId },
  ] }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.quality.repairCount === 3, `repairCount=${data.report.quality.repairCount}`);
  assert(data.report.quality.repairRounds > 0, `repairRounds should be > 0, got ${data.report.quality.repairRounds}`);
});

test('Report: text output is non-empty', () => {
  const r = runCliIn(reportDir, ['report', '--latest']);
  assert(r.status === 0, 'report text should exit 0');
  assert(r.stdout.length > 0, 'report text should not be empty');
});

// ============================================================
// 5b. V1.9.1 Report Boundary Hardening
// ============================================================

console.log('\n5b. Report Boundary (V1.9.1)');
console.log('============================');

test('Report: --latest --json returns valid JSON with latest run.id and decision', () => {
  const runId = 'report-latest-json';
  writeSessions(reportDir, { runs: [{
    id: runId, task: 'latest json test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(reportDir, '.moreagent', 'runs', runId),
    sessions: [],
  }] });
  const r = runCliIn(reportDir, ['report', '--latest', '--json']);
  assert(r.status === 0, `should exit 0, got ${r.status}`);
  const data = JSON.parse(r.stdout);
  assert(data.report.run.id === runId, `expected ${runId}, got ${data.report.run.id}`);
  assert(data.report.decision !== undefined, 'missing decision');
});

test('Report: --json defaults to latest (equivalent to --latest --json)', () => {
  const runId = 'report-json-default';
  writeSessions(reportDir, { runs: [
    { id: 'old-run', task: 'old', status: 'completed', createdAt: '2023-01-01T00:00:00Z', artifactDir: '/tmp/old', sessions: [] },
    { id: runId, task: 'newest', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId), sessions: [] },
  ] });

  const r1 = runCliIn(reportDir, ['report', '--json']);
  const r2 = runCliIn(reportDir, ['report', '--latest', '--json']);
  assert(r1.status === 0 && r2.status === 0, 'both should exit 0');
  const d1 = JSON.parse(r1.stdout);
  const d2 = JSON.parse(r2.stdout);
  assert(d1.report.run.id === runId, `--json: expected ${runId}, got ${d1.report.run.id}`);
  assert(d2.report.run.id === runId, `--latest --json: expected ${runId}, got ${d2.report.run.id}`);
  assert(d1.report.run.id === d2.report.run.id, '--json and --latest --json should return same run');
});

test('Report: --run missing non-json shows text error', () => {
  const r = runCliIn(reportDir, ['report', '--run', 'nonexistent-run-id']);
  assert(r.stdout.includes('Run not found'), `expected "Run not found", got: ${r.stdout.slice(0, 200)}`);
  let isJson = false;
  try { JSON.parse(r.stdout); isJson = true; } catch {}
  assert(!isJson, 'non-json mode should not output parseable JSON');
});

test('Report: full workflow all gates APPROVED => PASSED', () => {
  const runId = 'report-full-passed';
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeArtifactForReport(reportDir, runId, 'prd-reviewer', 'prd-decision.md', 'Decision: APPROVED\n\nOK');
  writeArtifactForReport(reportDir, runId, 'tech-reviewer', 'tech-review.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{
    id: runId, task: 'full approved', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(reportDir, '.moreagent', 'runs', runId),
    workflow: { profile: 'full', completedPhases: [] },
    sessions: [
      { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'pr-1', agentName: 'prd-reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'prd-reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'tr-1', agentName: 'tech-reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tech-reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'PASSED', `expected PASSED, got ${data.report.decision.overallStatus}`);
  assert(data.report.gates.prdGate === 'APPROVED', `prdGate=${data.report.gates.prdGate}`);
  assert(data.report.gates.techGate === 'APPROVED', `techGate=${data.report.gates.techGate}`);
});

test('Report: full workflow gate CHANGES_REQUESTED => FAILED', () => {
  const runId = 'report-full-cr';
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeArtifactForReport(reportDir, runId, 'prd-reviewer', 'prd-decision.md', 'Decision: CHANGES_REQUESTED\n\nNeeds work');
  writeArtifactForReport(reportDir, runId, 'tech-reviewer', 'tech-review.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{
    id: runId, task: 'full cr', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(reportDir, '.moreagent', 'runs', runId),
    workflow: { profile: 'full', completedPhases: [] },
    sessions: [
      { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'pr-1', agentName: 'prd-reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'prd-reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'tr-1', agentName: 'tech-reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tech-reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);
  assert(data.report.decision.overallStatus === 'FAILED', `expected FAILED, got ${data.report.decision.overallStatus}`);
  assert(data.report.gates.prdGate === 'CHANGES_REQUESTED', `prdGate=${data.report.gates.prdGate}`);
});

test('Report: JSON schema field stability', () => {
  const runId = 'report-schema';
  writeArtifactForReport(reportDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(reportDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(reportDir, { runs: [{
    id: runId, task: 'schema test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(reportDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(reportDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });
  const r = runCliIn(reportDir, ['report', '--run', runId, '--json']);
  const data = JSON.parse(r.stdout);

  const requiredFields = [
    ['report', 'run', 'id'],
    ['report', 'run', 'task'],
    ['report', 'run', 'status'],
    ['report', 'workflow', 'completedPhases'],
    ['report', 'workflow', 'totalPhases'],
    ['report', 'gates', 'prdGate'],
    ['report', 'gates', 'techGate'],
    ['report', 'quality', 'test'],
    ['report', 'quality', 'review'],
    ['report', 'worktree', 'hasWorktree'],
    ['report', 'merge', 'canMerge'],
    ['report', 'merge', 'mainClean'],
    ['report', 'decision', 'overallStatus'],
    ['report', 'decision', 'recommendation'],
  ];

  for (const fieldPath of requiredFields) {
    let obj = data;
    for (const key of fieldPath) {
      assert(obj && typeof obj === 'object' && key in obj, `missing field: ${fieldPath.join('.')}`);
      obj = obj[key];
    }
  }
});

// ============================================================
// 7. DASHBOARD (V2.0)
// ============================================================

console.log('\n7. Dashboard (V2.0)');
console.log('===================');

let dashDir;

function makeDashDir() {
  const dir = path.join(TMP, 'dash');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  runCliIn(dir, ['init']);
  execSync('git add -A && git commit -m init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function extractDashboardData(html) {
  const match = /window\.__MOREAGENT_DASHBOARD_DATA__\s*=\s*([\s\S]*?);\s*(?:\n\s*\()/.exec(html);
  if (!match) return null;
  return JSON.parse(match[1]);
}

test('Dashboard: init dir', () => {
  dashDir = makeDashDir();
  assert(fs.existsSync(dashDir), 'dash dir should exist');
});

test('Dashboard: smoke test — generates HTML, exits 0', () => {
  writeSessions(dashDir, { runs: [{
    id: 'dash-1', task: 'smoke test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-1'),
    sessions: [
      { id: 'i-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-1', 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId: 'dash-1' },
    ],
  }] });
  writeArtifactForReport(dashDir, 'dash-1', 'implementer', 'test-report.md', 'Result: PASS\n\nOK');

  const r = runCliIn(dashDir, ['dashboard']);
  assert(r.status === 0, `dashboard should exit 0, got ${r.status}`);
  const htmlPath = path.join(dashDir, '.moreagent', 'dashboard', 'index.html');
  assert(fs.existsSync(htmlPath), `default dashboard HTML should exist at ${htmlPath}`);
});

test('Dashboard: --output writes to specified path', () => {
  const outPath = path.join(TMP, 'dash-output', 'custom.html');
  const r = runCliIn(dashDir, ['dashboard', '--output', outPath]);
  assert(r.status === 0, `dashboard --output should exit 0, got ${r.status}`);
  assert(fs.existsSync(outPath), `custom output HTML should exist at ${outPath}`);
});

test('Dashboard: HTML structure — contains all required sections', () => {
  writeSessions(dashDir, { runs: [{
    id: 'dash-struct', task: 'structure test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-struct'),
    sessions: [
      { id: 's-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-struct', 'tester'), startedAt: '2024-01-01T00:00:00Z', runId: 'dash-struct' },
    ],
  }] });
  writeArtifactForReport(dashDir, 'dash-struct', 'tester', 'test-report.md', 'Result: PASS\n\nOK');

  const r = runCliIn(dashDir, ['dashboard', '--output', path.join(TMP, 'dash-struct.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-struct.html'), 'utf-8');
  assert(html.includes('Run List') || html.includes('MoreAgent Dashboard'), 'should contain Run List or Dashboard title');
  assert(html.includes('Workflow Report'), 'should contain Workflow Report');
  assert(html.includes('Gate'), 'should contain Gate');
  assert(html.includes('Repair Sessions'), 'should contain Repair Sessions');
  assert(html.includes('Merge Readiness'), 'should contain Merge Readiness');
  assert(html.includes('JSON / Debug'), 'should contain JSON / Debug');
  assert(html.includes('window.__MOREAGENT_DASHBOARD_DATA__'), 'should contain dashboard data');
});

test('Dashboard: runDetailsById contains latest run', () => {
  const runId = 'dash-details';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'details test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'd-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--output', path.join(TMP, 'dash-details.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-details.html'), 'utf-8');
  const data = extractDashboardData(html);
  assert(data !== null, 'should extract dashboard data from HTML');
  assert(data.runDetailsById[runId] !== undefined, `runDetailsById should contain ${runId}`);
  assert(data.selectedRunId === runId, `selectedRunId should be ${runId}, got ${data.selectedRunId}`);
});

test('Dashboard: non-full workflow (MVP) does not cause command failure', () => {
  const runId = 'dash-mvp';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'mvp run', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'm-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--output', path.join(TMP, 'dash-mvp.html')]);
  assert(r.status === 0, `dashboard with MVP run should exit 0, got ${r.status}`);
  const html = fs.readFileSync(path.join(TMP, 'dash-mvp.html'), 'utf-8');
  assert(html.includes('MVP run') || html.includes('workflow unavailable'), 'should show workflow unavailable for MVP run');
});

test('Dashboard: --limit controls number of embedded runs', () => {
  writeSessions(dashDir, { runs: [
    { id: 'limit-1', task: 'run 1', status: 'completed', createdAt: '2024-01-03T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'limit-1'), sessions: [] },
    { id: 'limit-2', task: 'run 2', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'limit-2'), sessions: [] },
    { id: 'limit-3', task: 'run 3', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'limit-3'), sessions: [] },
  ] });

  const r = runCliIn(dashDir, ['dashboard', '--limit', '2', '--output', path.join(TMP, 'dash-limit.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-limit.html'), 'utf-8');
  const data = extractDashboardData(html);
  assert(data !== null, 'should extract data');
  assert(data.runs.length === 2, `runs.length should be 2, got ${data.runs.length}`);
});

test('Dashboard: --run selects specified run', () => {
  writeSessions(dashDir, { runs: [
    { id: 'sel-1', task: 'selected run', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'sel-1'), sessions: [] },
    { id: 'sel-2', task: 'other run', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'sel-2'), sessions: [] },
  ] });

  const r = runCliIn(dashDir, ['dashboard', '--run', 'sel-2', '--output', path.join(TMP, 'dash-sel.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-sel.html'), 'utf-8');
  const data = extractDashboardData(html);
  assert(data !== null, 'should extract data');
  assert(data.selectedRunId === 'sel-2', `selectedRunId should be sel-2, got ${data.selectedRunId}`);
});

// ============================================================
// 7b. V2.0.1 Dashboard Hardening
// ============================================================

console.log('\n7b. Dashboard Hardening (V2.0.1)');
console.log('================================');

test('Dashboard: embedded JSON escapes closing script tag', () => {
  const runId = 'dash-xss';
  writeSessions(dashDir, { runs: [{
    id: runId,
    task: 'normal task </script><script>evil</script>',
    status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'x-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const outP = path.join(TMP, 'dash-xss.html');
  const r = runCliIn(dashDir, ['dashboard', '--output', outP]);
  assert(r.status === 0, `dashboard should exit 0, got ${r.status}`);
  const html = fs.readFileSync(outP, 'utf-8');

  // Must have the data marker
  assert(html.includes('window.__MOREAGENT_DASHBOARD_DATA__'), 'should contain data marker');

  // Extract the data section and verify no raw </script> appears in the data JSON
  const scriptStart = html.indexOf('window.__MOREAGENT_DASHBOARD_DATA__');
  const scriptEnd = html.indexOf('(function(){', scriptStart);
  const dataSection = html.slice(scriptStart, scriptEnd);
  assert(!dataSection.includes('</script>'), 'data section should not contain raw closing script tag');
  assert(!dataSection.includes('<script>'), 'data section should not contain raw opening script tag');

  // Data must still be parseable
  const data = extractDashboardData(html);
  assert(data !== null, 'should extract dashboard data');
  assert(data.runDetailsById[runId] !== undefined, 'run should be in data');
});

test('Dashboard: --limit invalid exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--limit', 'abc']);
  assert(r.status !== 0, `--limit abc should exit non-zero, got ${r.status}`);
});

test('Dashboard: --limit 0 exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--limit', '0']);
  assert(r.status !== 0, `--limit 0 should exit non-zero, got ${r.status}`);
});

test('Dashboard: --limit -1 exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--limit', '-1']);
  assert(r.status !== 0, `--limit -1 should exit non-zero, got ${r.status}`);
});

test('Dashboard: --limit partial numeric value exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--limit', '1abc']);
  assert(r.status !== 0, `--limit 1abc should exit non-zero, got ${r.status}`);
});

test('Dashboard: --limit decimal exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--limit', '1.5']);
  assert(r.status !== 0, `--limit 1.5 should exit non-zero, got ${r.status}`);
});

test('Dashboard: --run missing value exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--run']);
  assert(r.status !== 0, `--run with no value should exit non-zero, got ${r.status}`);
});

test('Dashboard: --output missing value exits 1', () => {
  const r = runCliIn(dashDir, ['dashboard', '--output']);
  assert(r.status !== 0, `--output with no value should exit non-zero, got ${r.status}`);
});

// ============================================================
// 7c. V2.1 Dashboard Usability Enhancements
// ============================================================

console.log('\n7c. Dashboard Usability (V2.1)');
console.log('==============================');

test('Dashboard: enhanced summary includes all decision fields', () => {
  const runId = 'dash-v21-summary';
  writeArtifactForReport(dashDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(dashDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'summary test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 's-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'r-1', agentName: 'reviewer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  execSync('git add -A && git commit -m "v21 summary data"', { cwd: dashDir, stdio: 'pipe' });

  const outP = path.join(TMP, 'dash-v21-summary.html');
  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', outP]);
  const html = fs.readFileSync(outP, 'utf-8');

  assert(html.includes('Overall Status'), 'should have Overall Status');
  assert(html.includes('Can Resume'), 'should have Can Resume');
  assert(html.includes('Can Merge'), 'should have Can Merge');
  assert(html.includes('Main Clean'), 'should have Main Clean');
  assert(html.includes('Worktree Exists'), 'should have Worktree Exists');
});

test('Dashboard: failed run has visible marker in sidebar', () => {
  const runId = 'dash-v21-failed';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'failed task', status: 'failed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'f-1', agentName: 'implementer', status: 'failed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--output', path.join(TMP, 'dash-v21-failed.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-failed.html'), 'utf-8');
  assert(html.includes('run-failed'), 'should have run-failed class on failed run item');
});

test('Dashboard: MERGE_READY shows ready reason explanation', () => {
  const runId = 'dash-v21-ready';
  writeArtifactForReport(dashDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(dashDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'ready test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  execSync('git add -A && git commit -m "v21 ready data"', { cwd: dashDir, stdio: 'pipe' });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-ready.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-ready.html'), 'utf-8');
  assert(html.includes('MERGE_READY'), 'should mention MERGE_READY');
  assert(html.includes('main repository is clean'), 'should explain why ready');
});

test('Dashboard: BLOCKED shows blocked reason explanation', () => {
  const runId = 'dash-v21-blocked';
  fs.writeFileSync(path.join(dashDir, '.moreagent', 'dirty-test'), 'x');
  writeArtifactForReport(dashDir, runId, 'tester', 'test-report.md', 'Result: PASS\n\nOK');
  writeArtifactForReport(dashDir, runId, 'reviewer', 'review-report.md', 'Decision: APPROVED\n\nOK');
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'blocked test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 't-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-blocked.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-blocked.html'), 'utf-8');
  assert(html.includes('BLOCKED'), 'should mention BLOCKED');
  assert(html.includes('not clean') || html.includes('uncommitted'), 'should explain why blocked');
  try { fs.unlinkSync(path.join(dashDir, '.moreagent', 'dirty-test')); } catch {}
});

test('Dashboard: completed run with FAILED overallStatus shows run-failed in sidebar', () => {
  const runId = 'dash-v21-comp-failed';
  writeArtifactForReport(dashDir, runId, 'tester', 'test-report.md', 'Result: FAIL\n\n# Test\nFailed tests');
  writeArtifactForReport(dashDir, runId, 'reviewer', 'review-report.md', 'Decision: CHANGES_REQUESTED\n\n# Review');
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'completed but failed', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'c-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'c-2', agentName: 'reviewer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'reviewer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-comp-failed.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-comp-failed.html'), 'utf-8');
  assert(html.includes('run-failed'), 'completed run with FAIL decision should have run-failed class');
  assert(html.includes("overallStatus==='FAILED'"), 'failed filter should include overallStatus FAILED check');
  assert(html.includes('var decision = report ? report.decision : null'), 'filter callback should define decision from report');
});

test('Dashboard: NEEDS_REPAIR merge explanation does not say BLOCKED', () => {
  const runId = 'dash-v21-repair';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'needs repair', status: 'failed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    workflow: { profile: 'full', completedPhases: ['brain', 'prd'], failedPhase: 'prd-review' },
    sessions: [
      { id: 'r-1', agentName: 'brain', status: 'completed', artifactDir: '/tmp/b', startedAt: '2024-01-01T00:00:00Z', runId },
      { id: 'r-2', agentName: 'product', status: 'completed', artifactDir: '/tmp/p', startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-repair.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-repair.html'), 'utf-8');

  assert(html.includes('run-failed'), 'NEEDS_REPAIR run should have run-failed class');
  assert(html.includes('not merge ready'), 'NEEDS_REPAIR explanation should include not merge ready');
  assert(!html.includes("'BLOCKED:'"), 'NEEDS_REPAIR explanation should not use BLOCKED: prefix');
});

test('Dashboard: JSON / Debug section still accessible', () => {
  const runId = 'dash-v21-debug';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'debug test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'd-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-debug.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-debug.html'), 'utf-8');
  assert(html.includes('JSON / Debug'), 'should have JSON / Debug section');
  assert(html.includes('Status JSON'), 'should have Status JSON tab');
  assert(html.includes('Report JSON'), 'should have Report JSON tab');
  assert(html.includes('Workflow JSON'), 'should have Workflow JSON tab');
});

test('Dashboard: MVP run still shows workflow unavailable', () => {
  const runId = 'dash-v21-mvp';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'mvp v21 test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'm-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v21-mvp.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v21-mvp.html'), 'utf-8');
  assert(html.includes('MVP run') || html.includes('workflow unavailable'), 'MVP run should show workflow unavailable');
});

// ============================================================
// 7d. V2.2 Dashboard Resilience
// ============================================================

console.log('\n7d. Dashboard Resilience (V2.2)');
console.log('===============================');

const { __dashboardTestHooks } = require('../dist/commands/dashboard');
const { safeText, safeBool, getNested, normalizeDecision, normalizeMerge, normalizeWorktree, normalizeGates, normalizeSessions } = __dashboardTestHooks;

// --- E2E tests ---

test('Dashboard: no runs renders empty state (exit 0)', () => {
  const dir = path.join(TMP, 'dash-empty');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, '.moreagent', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.moreagent', 'sessions.json'), JSON.stringify({ runs: [] }));

  const r = runCliIn(dir, ['dashboard', '--output', path.join(TMP, 'dash-empty.html')]);
  assert(r.status === 0, `empty dashboard should exit 0, got ${r.status}`);
  const html = fs.readFileSync(path.join(TMP, 'dash-empty.html'), 'utf-8');
  assert(html.includes('No runs found'), 'should contain No runs found');
  assert(html.includes('moreagent start'), 'should contain CLI suggestion');
});

test('Dashboard: empty sessions show No session data recorded', () => {
  const runId = 'dash-v22-empty-sess';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'no sessions', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v22-empty-sess.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v22-empty-sess.html'), 'utf-8');
  assert(html.includes('No session data recorded'), 'should show No session data recorded');
});

test('Dashboard: main UI contains no undefined or [object Object]', () => {
  const runId = 'dash-v22-safe';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'safety test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 's-1', agentName: 'tester', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'tester'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v22-safe.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v22-safe.html'), 'utf-8');

  // Exclude data script section, check only rendered HTML
  var mainStart = html.indexOf('<div id="main">');
  var scriptStart = html.indexOf('<script>', mainStart);
  var renderedHtml = html.slice(mainStart, scriptStart > 0 ? scriptStart : html.length);

  // Check for unsafe patterns in rendered area (not in data/script)
  assert(!renderedHtml.includes('>undefined<'), 'rendered UI should not contain undefined');
  assert(!renderedHtml.includes('[object Object]'), 'rendered UI should not contain [object Object]');
});

// --- Helper tests (via __dashboardTestHooks) ---

test('Helper: safeText returns fallback for null/undefined/empty', () => {
  assert(safeText(null, 'NA') === 'NA');
  assert(safeText(undefined, 'NA') === 'NA');
  assert(safeText('', 'NA') === 'NA');
  assert(safeText('hello', 'NA') === 'hello');
  assert(safeText(42, 'NA') === '42');
});

test('Helper: safeBool returns null for non-boolean values', () => {
  assert(safeBool(true) === true);
  assert(safeBool(false) === false);
  assert(safeBool(null) === null);
  assert(safeBool(undefined) === null);
  assert(safeBool('true') === null);
});

test('Helper: getNested traverses safely', () => {
  const obj = { a: { b: { c: 'val' } } };
  assert(getNested(obj, ['a', 'b', 'c'], 'fb') === 'val');
  assert(getNested(obj, ['a', 'x', 'c'], 'fb') === 'fb');
  assert(getNested(null, ['a'], 'fb') === 'fb');
});

test('Helper: normalizeDecision returns isMissing for missing decision', () => {
  const result = normalizeDecision(null);
  assert(result.isMissing === true);
  assert(result.overallStatus === 'unknown');
});

test('Helper: normalizeMerge returns isMissing for missing merge', () => {
  const result = normalizeMerge(null);
  assert(result.isMissing === true);
  assert(result.canMerge === null);
});

test('Helper: normalizeWorktree returns isMissing for missing worktree', () => {
  const result = normalizeWorktree(null);
  assert(result.isMissing === true);
  assert(result.path === 'Not available');
});

test('Helper: normalizeSessions returns unavailable for missing sessions', () => {
  assert(normalizeSessions(null).state === 'unavailable');
  assert(normalizeSessions({ run: {} }).state === 'unavailable');
  assert(normalizeSessions({ run: { sessions: [] } }).state === 'empty');
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
