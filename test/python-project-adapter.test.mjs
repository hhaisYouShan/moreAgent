import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectPythonProject, runPythonVerification } from '../adapters/projects/python-project-adapter.mjs';

async function createPythonProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moreagent-python-project-'));
  await mkdir(path.join(root, 'src/example'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'pyproject.toml'), `
[build-system]
requires = ["flit_core>=3.11"]
build-backend = "flit_core.buildapi"

[project]
name = "example-python-project"
version = "1.2.3"
requires-python = ">=3.11"
dependencies = ["typing-extensions>=4"]

[project.optional-dependencies]
test = ["pytest>=8"]

[dependency-groups]
docs = ["sphinx>=8"]
`);
  await writeFile(path.join(root, 'src/example/__init__.py'), '__version__ = "1.2.3"\n');
  await writeFile(path.join(root, 'tests/test_example.py'), 'def test_example():\n    assert True\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial Python fixture']);
  return root;
}

test('Python adapter parses pyproject.toml without changing Core contracts', async () => {
  const root = await createPythonProject();
  try {
    const report = inspectPythonProject({ projectRoot: root, sourcePaths: ['src/example'], testPaths: ['tests'] });
    assert.equal(report.adapterType, 'PYTHON_PROJECT');
    assert.equal(report.projectName, 'example-python-project');
    assert.equal(report.projectVersion, '1.2.3');
    assert.equal(report.requiresPython, '>=3.11');
    assert.equal(report.buildBackend, 'flit_core.buildapi');
    assert.deepEqual(report.optionalDependencyGroups, ['test']);
    assert.deepEqual(report.dependencyGroups, ['docs']);
    assert.match(report.baseCommit, /^[a-f0-9]{40}$/);
    assert.match(report.pyprojectHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(report.clean, true);
    assert.deepEqual(report.errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Python adapter records real command evidence', async () => {
  const root = await createPythonProject();
  try {
    const results = runPythonVerification({
      projectRoot: root,
      commands: [
        { verificationId: 'python-version', command: 'python', args: ['--version'] },
        { verificationId: 'python-script', command: 'python', args: ['-c', 'assert 2 + 2 == 4'] },
      ],
    });
    assert.deepEqual(results.map((result) => result.result), ['PASS', 'PASS']);
    assert.ok(results.every((result) => result.exitCode === 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}
