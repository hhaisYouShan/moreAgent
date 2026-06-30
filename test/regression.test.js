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
const http = require('http');
const os = require('os');

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'moreagent-test-'));

// Kill orphaned server processes from previous runs
try { execSync("pkill -f 'dashboard --serve --port 143' || true", { stdio: 'pipe' }); } catch {}
// Wait for ports to release
try { execSync('sleep 1'); } catch {}

let passed = 0;
let failed = 0;
const failures = [];
let lastAsyncPromise = Promise.resolve();

function test(name, fn) {
  lastAsyncPromise = lastAsyncPromise.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      const msg = e && e.message ? e.message : String(e);
      failures.push({ name, error: msg });
      console.log(`  ❌ ${name}: ${msg}`);
    }
  });
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

let testDirCounter = 0;
function initTestDir() {
  const dir = path.join(TMP, 'proj' + (testDirCounter++));
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
  execSync('git add -A', { cwd: mergeDir, stdio: 'pipe' }); try { execSync('git commit -m "second commit"', { cwd: mergeDir, stdio: 'pipe' }); } catch {}
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
test('JSON: init test dir', () => {
  jsonTestDir = initTestDir();
  writeSessions(jsonTestDir, { runs: [{
    id: 'json-test-1', task: 'json test', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(jsonTestDir, '.moreagent', 'runs', 'json-test-1'),
    sessions: [
      { id: 'a-1', agentName: 'architect', status: 'completed', artifactDir: '/tmp/a', startedAt: '2024-01-01T00:00:00Z', runId: 'json-test-1' },
    ],
  }]});
});

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
  try { execSync('git add -A && git commit -m "second" --allow-empty', { cwd: reportDir, stdio: 'pipe' }); } catch {}
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

  try { execSync('git add -A && git commit -m "merge-ready test data"', { cwd: reportDir, stdio: 'pipe' }); } catch {}

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
  try { execSync('git add -A && git commit -m init', { cwd: dir, stdio: 'pipe' }); } catch {}
  return dir;
}

function extractDashboardData(html) {
  const match = /window\.__MOREAGENT_DASHBOARD_DATA__\s*=\s*([\s\S]*?);\s*\n\s*(?:window\.__MOREAGENT_DASHBOARD_RUNTIME__|=)/.exec(html);
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

  try { execSync('git add -A && git commit -m "v21 summary data"', { cwd: dashDir, stdio: 'pipe' }); } catch {}

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

  try { execSync('git add -A && git commit -m "v21 ready data"', { cwd: dashDir, stdio: 'pipe' }); } catch {}

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

test('Helper: normalizeGates reads test/review from quality field', () => {
  const report = { report: { gates: { prdGate: 'APPROVED', techGate: 'APPROVED' }, quality: { test: 'PASS', review: 'APPROVED' } } };
  const result = normalizeGates(report);
  assert(result.prdGate === 'APPROVED', 'prdGate should be APPROVED');
  assert(result.techGate === 'APPROVED', 'techGate should be APPROVED');
  assert(result.test === 'PASS', 'test should be PASS (from quality)');
  assert(result.review === 'APPROVED', 'review should be APPROVED (from quality)');
});

test('Dashboard: MVP run renders all sections (not trapped in full_ok else)', () => {
  const runId = 'dash-v22-mvp-sec';
  writeSessions(dashDir, { runs: [{
    id: runId, task: 'mvp sections', status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    artifactDir: path.join(dashDir, '.moreagent', 'runs', runId),
    sessions: [
      { id: 'm-1', agentName: 'implementer', status: 'completed', artifactDir: path.join(dashDir, '.moreagent', 'runs', runId, 'implementer'), startedAt: '2024-01-01T00:00:00Z', runId },
    ],
  }] });

  const r = runCliIn(dashDir, ['dashboard', '--run', runId, '--output', path.join(TMP, 'dash-v22-mvp-sec.html')]);
  const html = fs.readFileSync(path.join(TMP, 'dash-v22-mvp-sec.html'), 'utf-8');
  // MVP run should still have Gate, Repair, Merge, Sessions, JSON/Debug sections
  assert(html.includes('Gate / Test / Review'), 'MVP should still have Gate section');
  assert(html.includes('Repair Sessions'), 'MVP should still have Repair Sessions');
  assert(html.includes('Merge Readiness'), 'MVP should still have Merge Readiness');
  assert(html.includes('JSON / Debug'), 'MVP should still have JSON/Debug');
});

test('Dashboard: empty dashboard script includes runs.length guard', () => {
  const html = fs.readFileSync(path.join(TMP, 'dash-empty.html'), 'utf-8');
  assert(html.includes('D.runs.length === 0'), 'empty dashboard should guard against no runs');
  assert(html.includes('No runs found'), 'should still show No runs found');
});

// ============================================================
// 7e. V2.3 Dashboard --open
// ============================================================

console.log('\n7e. Dashboard --open (V2.3)');
console.log('===========================');

test('Dashboard: --open exits 0 and writes default HTML', () => {
  writeSessions(dashDir, { runs: [{ id: 'dash-open-1', task: 'open test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-open-1'), sessions: [] }] });

  const r = runCliIn(dashDir, ['dashboard', '--open']);
  assert(r.status === 0, `--open should exit 0, got ${r.status}`);
  const htmlPath = path.join(dashDir, '.moreagent', 'dashboard', 'index.html');
  assert(fs.existsSync(htmlPath), 'default HTML should exist after --open');
});

test('Dashboard: --open prints Dashboard written path', () => {
  const r = runCliIn(dashDir, ['dashboard', '--open']);
  assert(r.stdout.includes('Dashboard written to'), `should print written path, got: ${r.stdout.slice(0,200)}`);
});

test('Dashboard: --output <path> --open opens correct path', () => {
  writeSessions(dashDir, { runs: [{ id: 'dash-open-out', task: 'output test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-open-out'), sessions: [] }] });

  const outPath = path.join(TMP, 'open-custom.html');
  // Set env to capture open command path
  const r = spawnSync('node', [CLI, 'dashboard', '--output', outPath, '--open'], {
    cwd: dashDir, encoding: 'utf-8', timeout: 10000,
    env: { ...process.env, MOREAGENT_DASHBOARD_OPEN_COMMAND: 'node -e "require(' + "fs" + ').writeFileSync(' + "'" + path.join(TMP, 'open-log.txt') + "'" + ', process.argv.slice(1).join(' + "' '" + '))" ' },
  });
  assert(r.status === 0, `--output --open should exit 0, got ${r.status}`);
  assert(fs.existsSync(outPath), 'custom output HTML should exist');
});

test('Dashboard: --run <id> --open keeps selectedRunId', () => {
  writeSessions(dashDir, { runs: [
    { id: 'open-sel-1', task: 'target', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'open-sel-1'), sessions: [] },
    { id: 'open-sel-2', task: 'other', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'open-sel-2'), sessions: [] },
  ] });

  const outP = path.join(TMP, 'open-sel.html');
  const r = runCliIn(dashDir, ['dashboard', '--run', 'open-sel-2', '--output', outP, '--open']);
  const html = fs.readFileSync(outP, 'utf-8');
  const data = extractDashboardData(html);
  assert(data !== null, 'should extract data');
  assert(data.selectedRunId === 'open-sel-2', `selectedRunId should be open-sel-2, got ${data.selectedRunId}`);
});

test('Dashboard: --limit 2 --open keeps run count', () => {
  writeSessions(dashDir, { runs: [
    { id: 'open-lim-1', task: 'r1', status: 'completed', createdAt: '2024-01-03T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'open-lim-1'), sessions: [] },
    { id: 'open-lim-2', task: 'r2', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'open-lim-2'), sessions: [] },
    { id: 'open-lim-3', task: 'r3', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'open-lim-3'), sessions: [] },
  ] });

  const outP = path.join(TMP, 'open-lim.html');
  const r = runCliIn(dashDir, ['dashboard', '--limit', '2', '--output', outP, '--open']);
  const data = extractDashboardData(fs.readFileSync(outP, 'utf-8'));
  assert(data !== null);
  assert(data.runs.length === 2, `runs.length should be 2, got ${data.runs.length}`);
});

test('Dashboard: open failure keeps exit 0 and HTML exists', () => {
  writeSessions(dashDir, { runs: [{ id: 'dash-open-fail', task: 'fail test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'dash-open-fail'), sessions: [] }] });

  const outP = path.join(TMP, 'open-fail.html');
  const r = spawnSync('node', [CLI, 'dashboard', '--output', outP, '--open'], {
    cwd: dashDir, encoding: 'utf-8', timeout: 10000,
    env: { ...process.env, MOREAGENT_DASHBOARD_OPEN_COMMAND: 'false' },
  });

  assert(r.status === 0, `open failure should still exit 0, got ${r.status}`);
  assert(fs.existsSync(outP), 'HTML should exist even when open fails');
  assert(r.stdout.includes('Open failed'), `should print Open failed, got: ${r.stdout.slice(0,300)}`);
  assert(r.stdout.includes('Dashboard was still generated at'), `should print fallback path, got: ${r.stdout.slice(0,300)}`);
});

test('Helper: openInDefaultBrowser returns ok:false for non-zero exit', () => {
  const prev = process.env.MOREAGENT_DASHBOARD_OPEN_COMMAND;
  process.env.MOREAGENT_DASHBOARD_OPEN_COMMAND = 'false';
  const result = __dashboardTestHooks.openInDefaultBrowser('/tmp/nonexistent.html');
  process.env.MOREAGENT_DASHBOARD_OPEN_COMMAND = prev;
  assert(result.ok === false, `should return ok false when open command fails, got ${JSON.stringify(result)}`);
});

test('Dashboard: --open appears in CLI help', () => {
  const r = runCli(['--help']);
  assert(r.stdout.includes('--open'), 'CLI help should include --open');
});

// ============================================================
// 8. V3.0 Dashboard --serve / --watch
// ============================================================

console.log('\n8. Dashboard Serve (V3.0)');
console.log('========================');

function startServer(args, env) {
  return startServerFresh(dashDir, args, env);
}

function startServerFresh(dir, args, env) {
  const proc = require('child_process').spawn('node', [CLI, ...args], {
    cwd: dir,
    env: { ...process.env, ...(env||{}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return proc;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function waitForServer(proc, maxWaitMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let done = false;
    let out = '';
    proc.stdout.on('data', (d) => {
      if (done) return;
      out += d.toString();
      const m = out.match(/URL:\s*(http:\/\/[^\s]+)/);
      if (m) {
        done = true;
        resolve(m[1]);
      }
    });
    proc.stderr.on('data', (d) => {
      if (!done && d.toString().includes('Error')) {
        done = true;
        reject(new Error(d.toString()));
      }
    });
    const check = setInterval(() => {
      if (Date.now() - start > (maxWaitMs || 10000)) {
        clearInterval(check);
        if (!done) { done = true; proc.kill('SIGTERM'); reject(new Error('Server start timeout')); }
      }
    }, 100);
  });
}

test('Dashboard: --watch without --serve exits non-zero', () => {
  const r = runCliIn(dashDir, ['dashboard', '--watch']);
  assert(r.status !== 0, `--watch without --serve should fail, got ${r.status}`);
});

test('Dashboard: --serve --host invalid exits non-zero', () => {
  const r = runCliIn(dashDir, ['dashboard', '--serve', '--host', '0.0.0.0']);
  assert(r.status !== 0, `invalid host should fail, got ${r.status}`);
});

test('Dashboard: --serve starts server and /health returns ok', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'serve-1', task: 'serve test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'serve-1'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14317']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url + 'health');
      assert(res.status === 200, `health should be 200, got ${res.status}`);
      const data = JSON.parse(res.body);
      assert(data.ok === true, `health should be ok`);
      p.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 400));
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: GET / returns HTML with MoreAgent Dashboard', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'serve-gh', task: 'html test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'serve-gh'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14324']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      assert(res.status === 200);
      assert(res.body.includes('MoreAgent Dashboard'));
      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: GET /data.json returns valid JSON with runs', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'serve-dj', task: 'json test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'serve-dj'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14325']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url + 'data.json');
      assert(res.status === 200);
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.runs));
      assert(typeof data.generatedAt === 'string');
      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: --limit 2 via serve limits runs count', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [
        { id: 'sv-lim-1', task: 'r1', status: 'completed', createdAt: '2024-01-03T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'sv-lim-1'), sessions: [] },
        { id: 'sv-lim-2', task: 'r2', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'sv-lim-2'), sessions: [] },
        { id: 'sv-lim-3', task: 'r3', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'sv-lim-3'), sessions: [] },
      ] });
      const p = startServer(['dashboard', '--serve', '--limit', '2', '--port', '14326']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url + 'data.json');
      const data = JSON.parse(res.body);
      assert(data.runs.length === 2, `--limit 2 should have exactly 2 runs, got ${data.runs.length}`);
      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: no runs returns empty serve dashboard', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [] });
      const p = startServer(['dashboard', '--serve', '--port', '14327']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      assert(res.body.includes('No runs found'), 'HTML should contain No runs found');
      const dj = await httpGet(url + 'data.json');
      const data = JSON.parse(dj.body);
      assert(data.runs.length === 0, '/data.json runs should be empty');
      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: --watch HTML contains watch config', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'watch-1', task: 'watch test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'watch-1'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--watch', '--port', '14328']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      assert(res.body.includes('"watchEnabled":true'));
      assert(res.body.includes('"dataEndpoint"'));
      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: --serve --open attempts URL not file path', function() {
  const logPath = path.join(TMP, 'open-target-v3.txt');
  const scriptPath = path.join(TMP, 'open-logger-v3.js');
  fs.writeFileSync(scriptPath, 'require("fs").writeFileSync("' + logPath.replace(/\\/g, '\\\\') + '", process.argv[2] || "")');
  return new Promise((resolve, reject) => {
    const proc = startServer(['dashboard', '--serve', '--open', '--port', '14329'], {
      MOREAGENT_DASHBOARD_OPEN_COMMAND: 'node ' + scriptPath,
    });
    let resolved = false;
    const t = setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill(); resolve(); }
    }, 8000);
    proc.stdout.on('data', (d) => {
      if (!resolved && d.toString().includes('Dashboard server started')) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(t);
            proc.kill();
            try {
              if (fs.existsSync(logPath)) {
                const target = fs.readFileSync(logPath, 'utf-8').trim();
                assert(target.startsWith('http://'), 'should open URL, got: ' + target);
              }
              resolve();
            } catch(e) { reject(e); }
          }
        }, 600);
      }
    });
  });
});

test('Dashboard: port conflict exits non-zero', function() {
  const p1 = startServer(['dashboard', '--serve', '--port', '14320']);
  return waitForServer(p1, 5000).then((url) => {
    const p2 = spawnSync('node', [CLI, 'dashboard', '--serve', '--port', '14320'], {
      cwd: dashDir, encoding: 'utf-8', timeout: 5000,
    });
    p1.kill();
    assert(p2.status !== 0, `second server should fail on same port, got exit ${p2.status}`);
  });
});

test('Dashboard: server close kills process cleanly', function() {
  return new Promise(async (resolve, reject) => {
    try {
      const p = startServer(['dashboard', '--serve', '--port', '14321']);
      await waitForServer(p, 8000);
      p.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
      assert(p.killed || p.exitCode !== null, 'server should be killed');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: --port 1abc exits non-zero', () => {
  const r = runCliIn(dashDir, ['dashboard', '--serve', '--port', '1abc']);
  assert(r.status !== 0, `--port 1abc should fail, got ${r.status}`);
});

test('Dashboard: --port 1.5 exits non-zero', () => {
  const r = runCliIn(dashDir, ['dashboard', '--serve', '--port', '1.5']);
  assert(r.status !== 0, `--port 1.5 should fail, got ${r.status}`);
});

test('Dashboard: --serve --run old-run --limit 1 includes selected run', function() {
  return new Promise(async (resolve, reject) => {
    try {
      const freshDir = path.join(TMP, 'persist-test');
      try { fs.rmSync(freshDir, { recursive: true }); } catch {}
      fs.mkdirSync(freshDir, { recursive: true });
      require('child_process').execSync('git init', { cwd: freshDir, stdio: 'pipe' });
      spawnSync('node', [CLI, 'init'], { cwd: freshDir, encoding: 'utf-8' });
      writeSessions(freshDir, { runs: [
    { id: 'persist-1', task: 'latest', status: 'completed', createdAt: '2024-01-03T00:00:00Z', artifactDir: path.join(freshDir, '.moreagent', 'runs', 'persist-1'), sessions: [] },
    { id: 'persist-2', task: 'middle', status: 'completed', createdAt: '2024-01-02T00:00:00Z', artifactDir: path.join(freshDir, '.moreagent', 'runs', 'persist-2'), sessions: [] },
    { id: 'persist-3', task: 'oldest-selected', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(freshDir, '.moreagent', 'runs', 'persist-3'), sessions: [] },
  ] });

  const p = startServerFresh(freshDir, ['dashboard', '--serve', '--run', 'persist-3', '--limit', '1', '--port', '14322']);
  const url = await waitForServer(p, 30000);
  const res = await httpGet(url + 'data.json');
  p.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 300));
  const data = JSON.parse(res.body);
  assert(data.selectedRunId === 'persist-3', `selectedRunId should be persist-3, got ${data.selectedRunId}`);
  assert(data.runs.some(r => r.id === 'persist-3'), 'runs should include persist-3 even outside limit');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: --serve --watch dataEndpoint selected run persists', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [
    { id: 'watch-persist-1', task: 'latest', status: 'completed', createdAt: '2024-01-03T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'watch-persist-1'), sessions: [] },
    { id: 'watch-persist-2', task: 'old', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'watch-persist-2'), sessions: [] },
  ] });

  const p = startServer(['dashboard', '--serve', '--watch', '--run', 'watch-persist-2', '--limit', '1', '--port', '14323']);
  const url = await waitForServer(p, 30000);
  const res1 = await httpGet(url + 'data.json');
  const d1 = JSON.parse(res1.body);
  assert(d1.selectedRunId === 'watch-persist-2', `first selectedRunId should persist, got ${d1.selectedRunId}`);
  const res2 = await httpGet(url + 'data.json');
  const d2 = JSON.parse(res2.body);
  assert(d2.selectedRunId === 'watch-persist-2', `refresh selectedRunId should still persist, got ${d2.selectedRunId}`);
  assert(d2.runs.some(r => r.id === 'watch-persist-2'), 'refresh should still include selected run');
  p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('Dashboard: async test infrastructure verification', function() {
  return new Promise(async (resolve) => {
    await new Promise(r => setTimeout(r, 50));
    assert(true, 'async test infrastructure works');
    resolve();
  });
});

// ============================================================
// 9. V3.1 Dashboard Serve Usability
// ============================================================

console.log('\n9. Dashboard Serve Usability (V3.1)');
console.log('===================================');

function captureServeOutput(args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = require('child_process').spawn('node', [CLI, ...args], {
      cwd: dashDir, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    const t = setTimeout(() => { proc.kill('SIGTERM'); resolve(out); }, timeoutMs || 10000);
    proc.stdout.on('data', function check() {
      if (out.includes('Dashboard server started') && out.includes('URL:')) {
        clearTimeout(t);
        setTimeout(() => { proc.kill('SIGTERM'); resolve(out); }, 300);
        proc.stdout.removeListener('data', check);
      }
    });
  });
}

test('V3.1: serve startup output shows runtime summary', async function() {
  writeSessions(dashDir, { runs: [{ id: 'v31-start', task: 'startup', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-start'), sessions: [] }] });
  const out = await captureServeOutput(['dashboard', '--serve', '--limit', '5', '--port', '14340']);
  assert(out.includes('Dashboard server started'), 'should contain Dashboard server started');
  assert(out.includes('URL:'), 'should contain URL');
  assert(out.includes('Host:'), 'should contain Host');
  assert(out.includes('Port:'), 'should contain Port');
  assert(out.includes('Watch: disabled'), 'should contain Watch: disabled');
  assert(out.includes('Refresh interval: manual'), 'should contain Refresh interval: manual');
  assert(out.includes('Selected run: latest'), 'should contain Selected run: latest');
  assert(out.includes('Limit: 5'), 'should contain Limit: 5');
});

test('V3.1: serve startup output shows watch enabled', async function() {
  writeSessions(dashDir, { runs: [{ id: 'v31-watch', task: 'watch test', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-watch'), sessions: [] }] });
  const out = await captureServeOutput(['dashboard', '--serve', '--watch', '--port', '14341']);
  assert(out.includes('Watch: enabled'), 'should contain Watch: enabled');
  assert(out.includes('Refresh interval: 3000ms'), 'should contain Refresh interval: 3000ms');
});

test('V3.1: serve startup output shows selected run', async function() {
  writeSessions(dashDir, { runs: [{ id: 'v31-sel', task: 'selected', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-sel'), sessions: [] }] });
  const out = await captureServeOutput(['dashboard', '--serve', '--run', 'v31-sel', '--port', '14342']);
  assert(out.includes('Selected run: v31-sel'), 'should contain Selected run: v31-sel');
});

test('V3.1: HTML contains Refresh data button', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'v31-btn', task: 'btn', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-btn'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14343']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      p.kill('SIGTERM');
      assert(res.body.includes('Refresh data'), 'HTML should contain Refresh data button');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('V3.1: HTML contains runtime status text', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'v31-rt', task: 'runtime', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-rt'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14344']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      p.kill('SIGTERM');
      assert(res.body.includes('Last refreshed'), 'should contain Last refreshed');
      assert(res.body.includes('Refreshing'), 'should contain Refreshing');
      assert(res.body.includes('Refresh failed'), 'should contain Refresh failed');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('V3.1: no-runs serve page contains Refresh data and runtime status', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [] });
      const p = startServer(['dashboard', '--serve', '--port', '14348']);
      const url = await waitForServer(p, 10000);
      const res = await httpGet(url);
      p.kill('SIGTERM');
      assert(res.body.includes('No runs found'), 'should show No runs found');
      assert(res.body.includes('Refresh data'), 'should have Refresh data button');
      assert(res.body.includes('runtime-status'), 'should have runtime-status element');
      assert(res.body.includes('Last refreshed'), 'should have Last refreshed');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('V3.1: no-runs serves refreshes to show new runs without crash', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [] });
      const p = startServer(['dashboard', '--serve', '--port', '14349']);
      const url = await waitForServer(p, 10000);

      // First fetch: no runs
      const res1 = await httpGet(url + 'data.json');
      const d1 = JSON.parse(res1.body);
      assert(d1.runs.length === 0, 'initially no runs');
      assert(d1.selectedRunId === null, 'initial selectedRunId should be null');
      assert(d1.generatedAt, 'should have generatedAt');

      // Add a run without restarting server
      writeSessions(dashDir, { runs: [{ id: 'v31-newrun', task: 'appeared later', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-newrun'), sessions: [] }] });

      // Second fetch: should now have runs
      const res2 = await httpGet(url + 'data.json');
      const d2 = JSON.parse(res2.body);
      assert(d2.runs.length === 1, 'should now have 1 run after refresh');
      assert(d2.selectedRunId === 'v31-newrun', 'selectedRunId should be the new run');
      assert(d2.runs[0].id === 'v31-newrun', 'run id should be v31-newrun');
      assert(d2.runs[0].task === 'appeared later', 'run task should be preserved');
      assert(d2.runDetailsById['v31-newrun'], 'runDetailsById should have entry');
      assert(d2.generatedAt, 'should have generatedAt');

      // HTML should render with the new run
      const res3 = await httpGet(url);
      assert(res3.body.includes('MoreAgent Dashboard'), 'HTML should still render');
      assert(res3.body.includes('v31-newrun'), 'HTML should contain the new run');
      assert(res3.body.includes('appeared later'), 'HTML should contain the task text');

      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

test('V3.1: runs cleared to empty refreshes to empty state', function() {
  return new Promise(async (resolve, reject) => {
    try {
      writeSessions(dashDir, { runs: [{ id: 'v31-clear', task: 'will be cleared', status: 'completed', createdAt: '2024-01-01T00:00:00Z', artifactDir: path.join(dashDir, '.moreagent', 'runs', 'v31-clear'), sessions: [] }] });
      const p = startServer(['dashboard', '--serve', '--port', '14350']);
      const url = await waitForServer(p, 10000);

      // First fetch: has runs
      const res1 = await httpGet(url + 'data.json');
      const d1 = JSON.parse(res1.body);
      assert(d1.runs.length === 1, 'initially 1 run');

      // Clear runs without restarting server
      writeSessions(dashDir, { runs: [] });
      const res2 = await httpGet(url + 'data.json');
      const d2 = JSON.parse(res2.body);
      assert(d2.runs.length === 0, 'should now have 0 runs');
      assert(d2.selectedRunId === null, 'selectedRunId should be null');

      p.kill('SIGTERM');
      resolve();
    } catch(e) { reject(e); }
  });
});

// ============================================================
// 10. V3.2 Init --full
// ============================================================

console.log('\n10. Init --full (V3.2)');
console.log('=====================');

function freshGitDir(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

test('init: default creates MVP bootstrap', () => {
  const dir = freshGitDir('v32-mvp');
  const r = runCliIn(dir, ['init']);
  assert(r.status === 0, 'default init should exit 0');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'config.yaml')), 'should create config.yaml');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'sessions.json')), 'should create sessions.json');
  const config = fs.readFileSync(path.join(dir, '.moreagent', 'config.yaml'), 'utf-8');
  assert(config.includes('architect'), 'MVP config should include architect');
  assert(config.includes('implementer'), 'MVP config should include implementer');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'architect.md')), 'should create architect agent');
  assert(!fs.existsSync(path.join(dir, '.moreagent', 'integration-guide.md')), 'MVP should not create integration guide');
});

test('init: --profile full creates full config and agents', () => {
  const dir = freshGitDir('v32-profile-full');
  const r = runCliIn(dir, ['init', '--profile', 'full']);
  assert(r.status === 0, '--profile full should exit 0');
  const config = fs.readFileSync(path.join(dir, '.moreagent', 'config.yaml'), 'utf-8');
  assert(config.includes('brain'), 'full config should include brain');
  assert(config.includes('product'), 'full config should include product');
  assert(config.includes('frontend'), 'full config should include frontend');
  assert(config.includes('backend'), 'full config should include backend');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'brain.md')), 'should create brain agent');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'product.md')), 'should create product agent');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'integration-guide.md')), 'should create integration guide');
});

test('init: --full creates full bootstrap', () => {
  const dir = freshGitDir('v32-full');
  const r = runCliIn(dir, ['init', '--full']);
  assert(r.status === 0, '--full should exit 0');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'config.yaml')), 'config.yaml');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'sessions.json')), 'sessions.json');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'tasks.json')), 'tasks.json');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'runtime-sessions.json')), 'runtime-sessions.json');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'integration-guide.md')), 'integration-guide.md');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'brain.md')), 'brain.md');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'frontend.md')), 'frontend.md');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'backend.md')), 'backend.md');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'tester.md')), 'tester.md');
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'reviewer.md')), 'reviewer.md');
});

test('init: --profile mvp --full exits non-zero', () => {
  const dir = freshGitDir('v32-conflict');
  const r = runCliIn(dir, ['init', '--profile', 'mvp', '--full']);
  assert(r.status !== 0, '--profile mvp --full should fail');
});

test('init: --profile abc exits non-zero', () => {
  const dir = freshGitDir('v32-bad-profile');
  const r = runCliIn(dir, ['init', '--profile', 'abc']);
  assert(r.status !== 0, '--profile abc should fail');
});

test('init: --profile missing value exits non-zero', () => {
  const dir = freshGitDir('v32-no-val');
  const r = runCliIn(dir, ['init', '--profile']);
  assert(r.status !== 0, '--profile missing value should fail');
});

test('init: repeated --full does not overwrite config', () => {
  const dir = freshGitDir('v32-repeat');
  runCliIn(dir, ['init', '--full']);
  const orig = fs.readFileSync(path.join(dir, '.moreagent', 'config.yaml'), 'utf-8');
  fs.writeFileSync(path.join(dir, '.moreagent', 'config.yaml'), orig + '\n# custom comment');
  runCliIn(dir, ['init', '--full']);
  const updated = fs.readFileSync(path.join(dir, '.moreagent', 'config.yaml'), 'utf-8');
  assert(updated.includes('custom comment'), 'config should not be overwritten');
});

test('init: repeated --full does not overwrite custom agent', () => {
  const dir = freshGitDir('v32-repeat-agent');
  runCliIn(dir, ['init', '--full']);
  fs.writeFileSync(path.join(dir, '.opencode', 'agents', 'frontend.md'), '# CUSTOM FRONTEND PROMPT');
  runCliIn(dir, ['init', '--full']);
  const content = fs.readFileSync(path.join(dir, '.opencode', 'agents', 'frontend.md'), 'utf-8');
  assert(content.includes('CUSTOM FRONTEND PROMPT'), 'custom agent should not be overwritten');
});

test('init: integration guide includes 9 phases and roles', () => {
  const dir = freshGitDir('v32-guide');
  runCliIn(dir, ['init', '--full']);
  const guide = fs.readFileSync(path.join(dir, '.moreagent', 'integration-guide.md'), 'utf-8');
  assert(guide.includes('brain'), 'should mention brain');
  assert(guide.includes('product'), 'should mention product');
  assert(guide.includes('frontend'), 'should mention frontend');
  assert(guide.includes('backend'), 'should mention backend');
  assert(guide.includes('tester'), 'should mention tester');
  assert(guide.includes('reviewer'), 'should mention reviewer');
  assert(guide.includes('moreagent start --once'), 'should include recommended command');
});

test('init: existing .moreagent without config still creates missing files', () => {
  const dir = freshGitDir('v32-missing');
  fs.mkdirSync(path.join(dir, '.moreagent'), { recursive: true });
  const r = runCliIn(dir, ['init', '--full']);
  assert(r.status === 0, 'should succeed');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'config.yaml')), 'should create config');
});

test('init: help shows --profile full and --full', () => {
  const r = runCli(['--help']);
  assert(r.stdout.includes('init --profile full'), 'help should include --profile full');
  assert(r.stdout.includes('init --full'), 'help should include --full');
});

test('init: MVP then --full skips integration guide with warning', () => {
  const dir = freshGitDir('v32-mvp-then-full');
  runCliIn(dir, ['init']);
  const r = runCliIn(dir, ['init', '--full']);
  assert(r.status === 0, 'should exit 0');
  // Config should NOT be overwritten
  const config = fs.readFileSync(path.join(dir, '.moreagent', 'config.yaml'), 'utf-8');
  assert(config.includes('architect'), 'MVP config should still contain architect');
  assert(!config.includes('name: brain'), 'MVP config should NOT contain brain');
  // Must NOT create full agents
  assert(!fs.existsSync(path.join(dir, '.opencode', 'agents', 'brain.md')), 'should not create brain');
  assert(!fs.existsSync(path.join(dir, '.opencode', 'agents', 'product.md')), 'should not create product');
  // Must NOT create integration guide
  assert(!fs.existsSync(path.join(dir, '.moreagent', 'integration-guide.md')), 'should not create integration guide');
  // Output must include warning
  const out = r.stdout + (r.stderr || '');
  assert(out.includes('manual migration required'), `should warn about manual migration, got: ${out.slice(0,500)}`);
  // Next must NOT mention integration-guide.md
  assert(!out.includes('integration-guide.md'), 'Next should not mention integration-guide.md');
});

test('init: full config missing agents and guide fills them in', () => {
  const dir = freshGitDir('v32-full-fill');
  // First: init --full creates everything
  runCliIn(dir, ['init', '--full']);
  // Remove brain agent and guide
  fs.unlinkSync(path.join(dir, '.opencode', 'agents', 'brain.md'));
  fs.unlinkSync(path.join(dir, '.moreagent', 'integration-guide.md'));
  // Re-run init --full
  const r = runCliIn(dir, ['init', '--full']);
  assert(r.status === 0, 'should exit 0');
  // Full agents and guide should be recreated (existing config IS full config)
  assert(fs.existsSync(path.join(dir, '.opencode', 'agents', 'brain.md')), 'brain agent should be recreated');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'integration-guide.md')), 'integration guide should be recreated');
});

test('init: existing config but missing tasks/runtime fills in', () => {
  const dir = freshGitDir('v32-fill');
  runCliIn(dir, ['init', '--full']);
  // Delete tasks and runtime-sessions
  fs.unlinkSync(path.join(dir, '.moreagent', 'tasks.json'));
  fs.unlinkSync(path.join(dir, '.moreagent', 'runtime-sessions.json'));
  // Re-run init
  runCliIn(dir, ['init', '--full']);
  assert(fs.existsSync(path.join(dir, '.moreagent', 'tasks.json')), 'tasks.json should be recreated');
  assert(fs.existsSync(path.join(dir, '.moreagent', 'runtime-sessions.json')), 'runtime-sessions.json should be recreated');
});

test('init: tasks.json has correct structure { tasks: [] }', () => {
  const dir = freshGitDir('v32-tasks');
  runCliIn(dir, ['init', '--full']);
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, '.moreagent', 'tasks.json'), 'utf-8'));
  assert(Array.isArray(tasks.tasks), 'tasks should be an array');
  assert(tasks.tasks.length === 0, 'tasks should be empty');
  assert(!('nextId' in tasks), 'tasks should not have nextId');
});

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

// Cleanup and summary
(async function finish() {
  try { await lastAsyncPromise; } catch(e) {}

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
})();
