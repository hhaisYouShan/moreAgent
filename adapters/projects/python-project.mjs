import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function inspectPythonProject({
  projectRoot,
  pyprojectPath = 'pyproject.toml',
  testPaths = ['tests'],
  sourcePaths = ['src'],
  runCommand = defaultRunCommand,
  now = () => new Date().toISOString(),
} = {}) {
  if (!projectRoot) throw new TypeError('projectRoot is required');
  const root = path.resolve(projectRoot);
  const manifestPath = resolveInside(root, pyprojectPath);
  const manifest = parsePyproject(manifestPath, runCommand);
  const python = runCommand({ command: 'python', args: ['--version'], cwd: root });
  const git = runCommand({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root });
  const status = runCommand({ command: 'git', args: ['status', '--porcelain'], cwd: root });

  return Object.freeze({
    schemaVersion: '1.0',
    adapterType: 'PYTHON_PROJECT',
    projectName: manifest.project?.name || null,
    projectVersion: manifest.project?.version || null,
    requiresPython: manifest.project?.['requires-python'] || null,
    dependencies: Object.freeze([...(manifest.project?.dependencies || [])]),
    optionalDependencyGroups: Object.freeze(Object.keys(manifest.project?.['optional-dependencies'] || {}).sort()),
    buildBackend: manifest['build-system']?.['build-backend'] || null,
    buildRequirements: Object.freeze([...(manifest['build-system']?.requires || [])]),
    pythonVersion: python.exitCode === 0 ? python.stdout.trim() : null,
    baseCommit: git.exitCode === 0 ? git.stdout.trim() : null,
    clean: status.exitCode === 0 && status.stdout.trim() === '',
    pyprojectPath,
    pyprojectHash: hashFileSync(manifestPath),
    sourcePaths: Object.freeze([...sourcePaths]),
    testPaths: Object.freeze([...testPaths]),
    generatedAt: new Date(now()).toISOString(),
    errors: Object.freeze([
      ...(python.exitCode === 0 ? [] : [`python_unavailable:${python.stderr}`]),
      ...(git.exitCode === 0 ? [] : [`git_unavailable:${git.stderr}`]),
      ...(status.exitCode === 0 ? [] : [`git_status_failed:${status.stderr}`]),
    ]),
  });
}

export function runPythonVerification({ projectRoot, commands = [], runCommand = defaultRunCommand, now = () => new Date().toISOString() } = {}) {
  if (!projectRoot) throw new TypeError('projectRoot is required');
  const root = path.resolve(projectRoot);
  return Object.freeze(commands.map((specification, index) => {
    if (!specification?.command) throw new TypeError(`commands[${index}].command is required`);
    const result = runCommand({
      command: specification.command,
      args: specification.args || [],
      cwd: resolveInside(root, specification.cwd || '.'),
      env: specification.env || {},
      timeoutMs: specification.timeoutMs || 900_000,
    });
    return Object.freeze({
      verificationId: specification.verificationId || `python-verify-${index + 1}`,
      command: [specification.command, ...(specification.args || [])].join(' '),
      cwd: specification.cwd || '.',
      exitCode: result.exitCode,
      result: result.exitCode === 0 ? 'PASS' : 'FAIL',
      stdout: result.stdout,
      stderr: result.stderr,
      executedAt: new Date(now()).toISOString(),
    });
  }));
}

function parsePyproject(manifestPath, runCommand) {
  const code = [
    'import json, pathlib, tomllib',
    `p=pathlib.Path(${JSON.stringify(manifestPath)})`,
    'with p.open("rb") as f: data=tomllib.load(f)',
    'print(json.dumps(data))',
  ].join(';');
  const result = runCommand({ command: 'python', args: ['-c', code], cwd: path.dirname(manifestPath) });
  if (result.exitCode !== 0) {
    const error = new Error(result.stderr || 'Failed to parse pyproject.toml');
    error.code = 'PYPROJECT_PARSE_FAILED';
    throw error;
  }
  return JSON.parse(result.stdout);
}

function defaultRunCommand({ command, args = [], cwd, env = {}, timeoutMs = 900_000 }) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function hashFileSync(filePath) {
  const result = spawnSync(process.execPath, ['-e', `const fs=require('node:fs'),c=require('node:crypto');process.stdout.write('sha256:'+c.createHash('sha256').update(fs.readFileSync(${JSON.stringify(filePath)})).digest('hex'))`], { encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) throw new Error(result.stderr || 'Failed to hash pyproject.toml');
  return result.stdout.trim();
}

function resolveInside(root, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Absolute path denied: ${relativePath}`);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes project root: ${relativePath}`);
  return target;
}
