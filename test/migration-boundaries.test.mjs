import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime core does not import the migration reference or hard-code BossResume', async () => {
  const sourceFiles = await listFiles(path.join(root, 'src'));
  const content = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')));
  const combined = content.join('\n');
  assert.doesNotMatch(combined, /migration-reference/);
  assert.doesNotMatch(combined, /bossresume/i);
});

test('reference manifest identifies the BossResume source snapshot', async () => {
  const manifestPath = path.join(root, 'migration-reference/bossresume-agent-loop/SOURCE-MANIFEST.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.source.repository, 'hhaisYouShan/bossResume');
  assert.equal(manifest.source.commit, 'd400f508ecaeb0cf20b8c6dae7b182af0111ffd2');
  assert.ok(manifest.files.length > 0);
});

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  }));
  return nested.flat();
}
