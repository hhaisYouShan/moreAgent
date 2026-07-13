import { hashContent } from './artifact-registry.mjs';

export function createTraceRegistry({ now = () => new Date().toISOString() } = {}) {
  const projectMaps = new Map();
  const traces = new Map();
  const contexts = new Map();
  let sequence = 0;

  return Object.freeze({
    registerProjectMap({ projectId, baseCommit, modules, metadata = {} }) {
      if (!projectId || !baseCommit || !Array.isArray(modules)) throw new TypeError('projectId, baseCommit and modules are required');
      const generatedAt = timestamp(now);
      const projectMap = deepFreeze({
        schemaVersion: '1.0',
        entityType: 'PROJECT_MAP',
        projectMapId: `project-map-${++sequence}`,
        projectId,
        baseCommit,
        hash: hashContent({ projectId, baseCommit, modules }),
        modules: structuredClone(modules),
        metadata: structuredClone(metadata),
        generatedAt,
        status: 'ACTIVE',
      });
      for (const [id, existing] of projectMaps) {
        if (existing.projectId === projectId && existing.status === 'ACTIVE') {
          projectMaps.set(id, deepFreeze({ ...existing, status: 'SUPERSEDED', supersededBy: projectMap.projectMapId }));
        }
      }
      projectMaps.set(projectMap.projectMapId, projectMap);
      invalidateContextsForProject(projectId, 'project_map_changed');
      return projectMap;
    },

    upsertRequirementTrace({ projectId, workflowId, requirementId, links = {} }) {
      for (const [name, value] of Object.entries({ projectId, workflowId, requirementId })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      const key = `${projectId}:${workflowId}:${requirementId}`;
      const existing = traces.get(key);
      const trace = deepFreeze({
        schemaVersion: '1.0',
        entityType: 'REQUIREMENT_TRACE',
        traceId: existing?.traceId || `trace-${++sequence}`,
        projectId,
        workflowId,
        requirementId,
        links: normalizeLinks({ ...(existing?.links || {}), ...links }),
        updatedAt: timestamp(now),
        version: Number(existing?.version || 0) + 1,
      });
      traces.set(key, trace);
      return trace;
    },

    createContextManifest({
      taskId,
      inputHash,
      projectMapId,
      files = [],
      artifactIds = [],
      decisionIds = [],
      editablePaths = [],
      forbiddenPaths = [],
      tokenBudget = 0,
      expiresAt = null,
    }) {
      const projectMap = requireProjectMap(projectMapId);
      if (projectMap.status !== 'ACTIVE') throw traceError('PROJECT_MAP_NOT_ACTIVE', `Project Map is not active: ${projectMapId}.`);
      for (const [name, value] of Object.entries({ taskId, inputHash, projectMapId })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      const context = deepFreeze({
        schemaVersion: '1.0',
        entityType: 'CONTEXT_MANIFEST',
        contextManifestId: `context-${++sequence}`,
        taskId,
        inputHash,
        projectMapId,
        projectId: projectMap.projectId,
        files: structuredClone(files),
        artifactIds: unique(artifactIds),
        decisionIds: unique(decisionIds),
        editablePaths: unique(editablePaths),
        forbiddenPaths: unique(forbiddenPaths),
        tokenBudget,
        createdAt: timestamp(now),
        expiresAt,
        status: 'ACTIVE',
        invalidationReason: null,
      });
      contexts.set(context.contextManifestId, context);
      return context;
    },

    validateContext(contextManifestId, { inputHash, projectMapId = null, fileHashes = {}, artifactHashes = {}, nowValue = null } = {}) {
      const context = requireContext(contextManifestId);
      const errors = [];
      if (context.status !== 'ACTIVE') errors.push(`context_${context.status.toLowerCase()}`);
      if (inputHash && context.inputHash !== inputHash) errors.push('input_hash_mismatch');
      if (projectMapId && context.projectMapId !== projectMapId) errors.push('project_map_mismatch');
      const projectMap = requireProjectMap(context.projectMapId);
      if (projectMap.status !== 'ACTIVE') errors.push('project_map_not_active');
      if (context.expiresAt && Date.parse(context.expiresAt) <= Date.parse(nowValue || timestamp(now))) errors.push('context_expired');
      for (const file of context.files) {
        if (fileHashes[file.path] && fileHashes[file.path] !== file.hash) errors.push(`file_hash_mismatch:${file.path}`);
      }
      for (const artifactId of context.artifactIds) {
        if (artifactHashes[artifactId] === false) errors.push(`artifact_invalid:${artifactId}`);
      }
      return deepFreeze({ valid: errors.length === 0, errors });
    },

    invalidateContext(contextManifestId, reason) {
      if (!reason) throw new TypeError('reason is required');
      const context = requireContext(contextManifestId);
      const invalid = deepFreeze({ ...context, status: 'INVALID', invalidationReason: reason });
      contexts.set(contextManifestId, invalid);
      return invalid;
    },

    assessTraceCompleteness({ projectId, workflowId, requirementIds = [] }) {
      const missing = [];
      const incomplete = [];
      for (const requirementId of requirementIds) {
        const trace = traces.get(`${projectId}:${workflowId}:${requirementId}`);
        if (!trace) {
          missing.push(requirementId);
          continue;
        }
        const links = trace.links;
        const requiredGroups = ['designArtifactIds', 'taskIds', 'commitShas', 'testEvidenceIds', 'gateIds', 'acceptanceIds'];
        const missingGroups = requiredGroups.filter((group) => !(links[group] || []).length);
        if (missingGroups.length) incomplete.push({ requirementId, missingGroups });
      }
      return deepFreeze({ complete: !missing.length && !incomplete.length, missing, incomplete });
    },

    getProjectMap(projectMapId) {
      return projectMaps.get(projectMapId) || null;
    },
    getContext(contextManifestId) {
      return contexts.get(contextManifestId) || null;
    },
    getTrace({ projectId, workflowId, requirementId }) {
      return traces.get(`${projectId}:${workflowId}:${requirementId}`) || null;
    },
  });

  function invalidateContextsForProject(projectId, reason) {
    for (const [contextId, context] of contexts) {
      if (context.projectId === projectId && context.status === 'ACTIVE') {
        contexts.set(contextId, deepFreeze({ ...context, status: 'INVALID', invalidationReason: reason }));
      }
    }
  }

  function requireProjectMap(projectMapId) {
    const value = projectMaps.get(projectMapId);
    if (!value) throw traceError('PROJECT_MAP_NOT_FOUND', `Project Map not found: ${projectMapId}.`);
    return value;
  }
  function requireContext(contextManifestId) {
    const value = contexts.get(contextManifestId);
    if (!value) throw traceError('CONTEXT_NOT_FOUND', `Context Manifest not found: ${contextManifestId}.`);
    return value;
  }
}

function normalizeLinks(links) {
  const result = {};
  for (const key of ['designArtifactIds', 'taskIds', 'commitShas', 'testEvidenceIds', 'gateIds', 'acceptanceIds']) result[key] = unique(links[key] || []);
  return result;
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

function traceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
