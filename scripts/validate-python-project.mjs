#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inspectPythonProject, runPythonVerification } from '../adapters/projects/python-project-adapter.mjs';

const options = parseArgs(process.argv.slice(2));
for (const required of ['project', 'profile', 'outputDir']) {
  if (!options[required]) {
    console.error(`Missing --${toKebab(required)}`);
    process.exit(2);
  }
}

const projectRoot = path.resolve(options.project);
const outputDir = path.resolve(options.outputDir);
const profile = JSON.parse(await readFile(path.resolve(options.profile), 'utf8'));
await mkdir(outputDir, { recursive: true });

const pythonProfile = profile.python || {};
const inspection = inspectPythonProject({
  projectRoot,
  pyprojectPath: pythonProfile.pyprojectPath || 'pyproject.toml',
  sourcePaths: pythonProfile.sourcePaths || ['src'],
  testPaths: pythonProfile.testPaths || ['tests'],
});
const verification = runPythonVerification({
  projectRoot,
  commands: pythonProfile.verificationCommands || [],
});

await writeJson(path.join(outputDir, 'itsdangerous-python-report.json'), inspection);
await writeJson(path.join(outputDir, 'itsdangerous-verification-report.json'), {
  schemaVersion: '1.0',
  reportType: 'PYTHON_PROJECT_VERIFICATION',
  projectId: profile.projectId,
  status: verification.every((item) => item.result === 'PASS') ? 'PASSED' : 'FAILED',
  results: verification,
  generatedAt: new Date().toISOString(),
});

console.log(`[python-project] name: ${inspection.projectName}`);
console.log(`[python-project] commit: ${inspection.baseCommit}`);
console.log(`[python-project] verification: ${verification.every((item) => item.result === 'PASS') ? 'PASSED' : 'FAILED'}`);
process.exit(inspection.errors.length === 0 && verification.every((item) => item.result === 'PASS') ? 0 : 1);

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) continue;
    const [key, inline] = value.slice(2).split('=', 2);
    result[toCamel(key)] = inline ?? args[++index];
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
