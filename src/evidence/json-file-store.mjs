import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createJsonFileStore({ rootPath }) {
  if (!rootPath) throw new TypeError('rootPath is required');

  return Object.freeze({
    async write(relativePath, value, { immutable = false } = {}) {
      const target = resolveSafe(relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      if (immutable && await exists(target)) throw storeError('IMMUTABLE_RECORD_EXISTS', `Record already exists: ${relativePath}.`);
      const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
      const payload = `${JSON.stringify(value, null, 2)}\n`;
      try {
        await writeFile(temp, payload, { encoding: 'utf8', flag: 'wx' });
        const handle = await open(temp, 'r');
        await handle.sync();
        await handle.close();
        await rename(temp, target);
        return Object.freeze({ path: target, bytes: Buffer.byteLength(payload) });
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    },

    async read(relativePath) {
      const target = resolveSafe(relativePath);
      return JSON.parse(await readFile(target, 'utf8'));
    },

    async appendJsonLine(relativePath, value) {
      const target = resolveSafe(relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const handle = await open(target, 'a');
      try {
        const payload = `${JSON.stringify(value)}\n`;
        await handle.write(payload);
        await handle.sync();
        return Object.freeze({ path: target, bytes: Buffer.byteLength(payload) });
      } finally {
        await handle.close();
      }
    },

    async exists(relativePath) {
      return exists(resolveSafe(relativePath));
    },

    resolve(relativePath) {
      return resolveSafe(relativePath);
    },
  });

  function resolveSafe(relativePath) {
    if (!relativePath || path.isAbsolute(relativePath)) throw storeError('INVALID_RELATIVE_PATH', 'A non-empty relative path is required.');
    const root = path.resolve(rootPath);
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw storeError('PATH_ESCAPE_DENIED', `Path escapes store root: ${relativePath}.`);
    return target;
  }
}

async function exists(target) {
  try {
    await readFile(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
