#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readAdapter, inspectStateSources } from './core/state-sources.mjs';

const [command, ...args] = process.argv.slice(2);

if (command !== 'state' || args[0] !== 'inspect') {
  console.error('Usage: moreagent state inspect --project <path> --adapter <path>');
  process.exit(64);
}

const options = readOptions(args.slice(1));
if (!options.project || !options.adapter) {
  console.error('Both --project and --adapter are required.');
  process.exit(64);
}

try {
  const adapter = await readAdapter(path.resolve(options.adapter));
  const result = await inspectStateSources({ projectRoot: path.resolve(options.project), adapter });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.splitDetected ? 2 : 0;
} catch (error) {
  console.error(`[moreagent] ${error.message}`);
  process.exitCode = 1;
}

function readOptions(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value) continue;
    result[key.slice(2)] = value;
  }
  return result;
}
