import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_EXCLUDES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.agent-runs', '.agent-worktrees']);

export async function inspectProject({ projectRoot, profile, mode = 'inspect', now = () => new Date().toISOString(), runCommand = defaultRunCommand } = {}) {
  if (!projectRoot) throw new TypeError('projectRoot is required');
  if (!profile?.projectId) throw new TypeError('profile.projectId is required');
  if (!['inspect', 'verify'].includes(mode)) throw new TypeError('mode must be inspect or verify');

  const root = path.resolve(projectRoot);
  const generatedAt = timestamp(now);
  const git = inspectGit(root, runCommand);
  const requiredPaths = await inspectRequiredPaths(root, profile.requiredPaths || []);
  const manifests = await inspectManifests(root, profile.manifests || []);
  const scan = await scanProject(root, {
    moduleRoots: profile.moduleRoots || ['.'],
    excludes: new Set([...(profile.excludes || []), ...DEFAULT_EXCLUDES]),
    maxFiles: profile.maxFiles || 20_000,
  });
  const verificationResults = mode === 'verify'
    ? executeVerificationCommands(root, profile.verificationCommands || [], manifests, runCommand, now)
    : [];

  const blockingChecks = [
    ...requiredPaths.filter((item) => item.required && !item.exists).map((item) => `missing_required_path:${item.path}`),
    ...manifests.filter((item) => item.required && !item.exists).map((item) => `missing_required_manifest:${item.path}`),
    ...manifests.filter((item) => item.exists && item.parseError).map((item) => `invalid_manifest:${item.path}`),
    ...verificationResults.filter((item) => item.required && item.result !== 'PASS').map((item) => `verification_failed:${item.verificationId}`),
  ];

  const projectMap = {
    schemaVersion: '1.0',
    entityType: 'PROJECT_MAP',
    projectMapId: `project-map-${profile.projectId}-${shortHash(git.commit || generatedAt)}`,
    projectId: profile.projectId,
    baseCommit: git.commit || 'UNRESOLVED',
    hash: hashJson({ git, requiredPaths, manifests: manifests.map(stripManifestContent), scan }),
    modules: scan.modules,
    metadata: {
      repository: profile.repository,
      branch: git.branch,
      clean: git.clean,
      packageManagers: scan.packageManagers,
      languages: scan.languages,
      fileCount: scan.fileCount,
    },
    generatedAt,
    status: 'ACTIVE',
  };

  return deepFreeze({
    schemaVersion: '1.0',
    reportType: 'PROJECT_BASELINE_VALIDATION',
    projectId: profile.projectId,
    repository: profile.repository,
    mode,
    status: blockingChecks.length ? 'FAILED' : 'PASSED',
    failureReasons: blockingChecks,
    git,
    requiredPaths,
    manifests: manifests.map(stripManifestContent),
    projectMap,
    verificationResults,
    generatedAt,
  });
}

async function inspectRequiredPaths(root, definitions) {
  const results = [];
  for (const definition of definitions) {
    const relativePath = typeof definition === 'string' ? definition : definition.path;
    const required = typeof definition === 'string' ? true : definition.required !== false;
    const expectedType = typeof definition === 'string' ? null : definition.type || null;
    const target = resolveInside(root, relativePath);
    let information = null;
    try {
      information = await stat(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const actualType = information?.isDirectory() ? 'directory' : information?.isFile() ? 'file' : null;
    results.push({
      path: relativePath,
      required,
      expectedType,
      exists: Boolean(information),
      actualType,
      typeMatches: !information || !expectedType || expectedType === actualType,
    });
  }
  return results;
}

async function inspectManifests(root, definitions) {
  const results = [];
  for (const definition of definitions) {
    const relativePath = definition.path;
    const required = definition.required !== false;
    const target = resolveInside(root, relativePath);
    let content = null;
    let parsed = null;
    let parseError = null;
    try {
      content = await readFile(target, 'utf8');
      parsed = JSON.parse(content);
    } catch (error) {
      if (error?.code !== 'ENOENT') parseError = error.message;
    }
    results.push({
      path: relativePath,
      required,
      exists: content !== null,
      parseError,
      name: parsed?.name || null,
      packageManager: parsed?.packageManager || null,
      scripts: parsed?.scripts || {},
      dependencies: Object.keys(parsed?.dependencies || {}).sort(),
      devDependencies: Object.keys(parsed?.devDependencies || {}).sort(),
      contentHash: content === null ? null : hashText(content),
      parsed,
    });
  }
  return results;
}

async function scanProject(root, { moduleRoots, excludes, maxFiles }) {
  const files = [];
  for (const moduleRoot of moduleRoots) {
    const absoluteRoot = resolveInside(root, moduleRoot);
    await walk(absoluteRoot, root, files, excludes, maxFiles);
  }
  const uniqueFiles = [...new Set(files)].sort();
  const extensionCounts = {};
  for (const file of uniqueFiles) {
    const extension = path.extname(file).toLowerCase() || '[no-extension]';
    extensionCounts[extension] = (extensionCounts[extension] || 0) + 1;
  }
  const manifestFiles = uniqueFiles.filter((file) => /(^|\/)package\.json$|(^|\/)pyproject\.toml$|(^|\/)requirements[^/]*\.txt$|(^|\/)pom\.xml$|(^|\/)build\.gradle/.test(file));
  const packageManagers = unique([
    ...(uniqueFiles.some((file) => file.endsWith('pnpm-lock.yaml')) ? ['pnpm'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('yarn.lock')) ? ['yarn'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('package-lock.json')) ? ['npm'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('uv.lock')) ? ['uv'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('poetry.lock')) ? ['poetry'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('requirements.txt')) ? ['pip'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('pom.xml')) ? ['maven'] : []),
    ...(uniqueFiles.some((file) => file.endsWith('build.gradle') || file.endsWith('build.gradle.kts')) ? ['gradle'] : []),
  ]);
  const languages = inferLanguages(extensionCounts);
  const modules = moduleRoots.map((moduleRoot) => ({
    moduleId: sanitizeId(moduleRoot === '.' ? 'root' : moduleRoot),
    path: moduleRoot,
    fileCount: uniqueFiles.filter((file) => moduleRoot === '.' || file === moduleRoot || file.startsWith(`${normalize(moduleRoot)}/`)).length,
    manifestFiles: manifestFiles.filter((file) => moduleRoot === '.' || file.startsWith(`${normalize(moduleRoot)}/`)),
  }));
  return { fileCount: uniqueFiles.length, files: uniqueFiles, extensionCounts, packageManagers, languages, modules };
}

async function walk(current, root, files, excludes, maxFiles) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    const relative = normalize(path.relative(root, absolute));
    if (entry.isDirectory()) await walk(absolute, root, files, excludes, maxFiles);
    else if (entry.isFile()) files.push(relative);
    if (files.length > maxFiles) throw inspectorError('PROJECT_SCAN_LIMIT_EXCEEDED', `Project scan exceeded ${maxFiles} files.`);
  }
}

function inspectGit(root, runCommand) {
  const commit = runCommand({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root });
  const branch = runCommand({ command: 'git', args: ['branch', '--show-current'], cwd: root });
  const status = runCommand({ command: 'git', args: ['status', '--porcelain'], cwd: root });
  return {
    commit: commit.exitCode === 0 ? commit.stdout.trim() : null,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    clean: status.exitCode === 0 && !status.stdout.trim(),
    statusLines: status.exitCode === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : [],
    errors: [commit, branch, status].filter((result) => result.exitCode !== 0).map((result) => result.stderr || 'git_command_failed'),
  };
}

function executeVerificationCommands(root, definitions, manifests, runCommand, now) {
  const manifestMap = new Map(manifests.map((manifest) => [manifest.path, manifest]));
  return definitions.map((definition) => {
    const manifest = definition.manifestPath ? manifestMap.get(definition.manifestPath) : null;
    const required = definition.required !== false;
    if (definition.whenScript && !manifest?.scripts?.[definition.whenScript]) {
      return {
        verificationId: definition.verificationId,
        required,
        command: formatCommand(definition),
        cwd: definition.cwd || '.',
        exitCode: null,
        executedAt: timestamp(now),
        result: required ? 'FAIL' : 'SKIPPED_NOT_REQUIRED',
        reason: `script_not_found:${definition.whenScript}`,
        stdout: '',
        stderr: '',
      };
    }
    const result = runCommand({ command: definition.command, args: definition.args || [], cwd: resolveInside(root, definition.cwd || '.'), env: definition.env || {}, timeoutMs: definition.timeoutMs || 600_000 });
    return {
      verificationId: definition.verificationId,
      required,
      command: formatCommand(definition),
      cwd: definition.cwd || '.',
      exitCode: result.exitCode,
      executedAt: timestamp(now),
      result: result.exitCode === 0 ? 'PASS' : 'FAIL',
      reason: result.exitCode === 0 ? null : 'command_failed',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  });
}

function defaultRunCommand({ command, args = [], cwd, env = {}, timeoutMs = 600_000 }) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: false, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function stripManifestContent(manifest) {
  const { parsed, ...rest } = manifest;
  return rest;
}

function inferLanguages(extensionCounts) {
  const mapping = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.go': 'Go', '.rs': 'Rust', '.vue': 'Vue', '.sql': 'SQL' };
  const counts = {};
  for (const [extension, count] of Object.entries(extensionCounts)) {
    const language = mapping[extension];
    if (language) counts[language] = (counts[language] || 0) + count;
  }
  return Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([language, fileCount]) => ({ language, fileCount }));
}

function resolveInside(root, relativePath) {
  if (path.isAbsolute(relativePath)) throw inspectorError('ABSOLUTE_PATH_DENIED', `Absolute path is not allowed: ${relativePath}.`);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw inspectorError('PATH_ESCAPE_DENIED', `Path escapes project root: ${relativePath}.`);
  return target;
}

function formatCommand(definition) {
  return [definition.command, ...(definition.args || [])].join(' ');
}

function hashJson(value) {
  return hashText(JSON.stringify(value));
}

function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
}

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function unique(values) {
  return [...new Set(values)].sort();
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function inspectorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
