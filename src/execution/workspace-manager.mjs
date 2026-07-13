import { WorkspaceStatus, WorkspaceType } from '../domain/enums.mjs';

export function createWorkspaceManager({ providers = [], now = () => new Date().toISOString() } = {}) {
  const providerMap = new Map();
  const workspaces = new Map();
  let sequence = 0;
  for (const provider of providers) registerProvider(provider);

  return Object.freeze({
    registerProvider,

    async create({ providerId, projectId, taskId, baseCommit, branch = null, metadata = {} }) {
      const provider = requireProvider(providerId);
      for (const [name, value] of Object.entries({ projectId, taskId, baseCommit })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      const workspaceId = `workspace-${++sequence}`;
      const createdAt = timestamp();
      workspaces.set(workspaceId, freezeWorkspace({
        schemaVersion: '1.0',
        entityType: 'WORKSPACE',
        workspaceId,
        projectId,
        taskId,
        providerId,
        workspaceType: provider.workspaceType,
        path: '',
        baseCommit,
        branch,
        status: WorkspaceStatus.CREATING,
        createdAt,
        updatedAt: createdAt,
        metadata: Object.freeze({ ...metadata }),
        version: 1,
      }));

      try {
        const result = await provider.create({ workspaceId, projectId, taskId, baseCommit, branch, metadata });
        if (!result?.path) throw workspaceError('WORKSPACE_PATH_REQUIRED', `${providerId} did not return a workspace path.`);
        const ready = freezeWorkspace({
          ...workspaces.get(workspaceId),
          path: result.path,
          branch: result.branch ?? branch,
          status: WorkspaceStatus.READY,
          providerMetadata: Object.freeze({ ...(result.metadata || {}) }),
          updatedAt: timestamp(),
          version: 2,
        });
        workspaces.set(workspaceId, ready);
        return ready;
      } catch (error) {
        const failed = freezeWorkspace({
          ...workspaces.get(workspaceId),
          status: WorkspaceStatus.FAILED,
          failureReason: error?.message || String(error),
          updatedAt: timestamp(),
          version: 2,
        });
        workspaces.set(workspaceId, failed);
        throw error;
      }
    },

    markInUse(workspaceId) {
      return transition(workspaceId, [WorkspaceStatus.READY], WorkspaceStatus.IN_USE);
    },

    markStale(workspaceId, reason = 'stale') {
      const workspace = requireWorkspace(workspaceId);
      if ([WorkspaceStatus.RELEASED, WorkspaceStatus.FAILED].includes(workspace.status)) return workspace;
      const updated = freezeWorkspace({ ...workspace, status: WorkspaceStatus.STALE, failureReason: reason, updatedAt: timestamp(), version: workspace.version + 1 });
      workspaces.set(workspaceId, updated);
      return updated;
    },

    async release(workspaceId, { force = false } = {}) {
      const workspace = requireWorkspace(workspaceId);
      if (workspace.status === WorkspaceStatus.RELEASED) return workspace;
      const provider = requireProvider(workspace.providerId);
      const releasing = freezeWorkspace({ ...workspace, status: WorkspaceStatus.RELEASING, updatedAt: timestamp(), version: workspace.version + 1 });
      workspaces.set(workspaceId, releasing);
      try {
        await provider.release?.({ workspace: releasing, force });
        const released = freezeWorkspace({ ...releasing, status: WorkspaceStatus.RELEASED, releasedAt: timestamp(), updatedAt: timestamp(), version: releasing.version + 1 });
        workspaces.set(workspaceId, released);
        return released;
      } catch (error) {
        const failed = freezeWorkspace({ ...releasing, status: WorkspaceStatus.FAILED, failureReason: error?.message || String(error), updatedAt: timestamp(), version: releasing.version + 1 });
        workspaces.set(workspaceId, failed);
        throw error;
      }
    },

    get(workspaceId) {
      return workspaces.get(workspaceId) || null;
    },

    list() {
      return Object.freeze([...workspaces.values()].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)));
    },
  });

  function registerProvider(provider) {
    validateProvider(provider);
    if (providerMap.has(provider.providerId)) throw workspaceError('WORKSPACE_PROVIDER_ALREADY_REGISTERED', `Provider is already registered: ${provider.providerId}.`);
    providerMap.set(provider.providerId, Object.freeze({ ...provider }));
    return providerMap.get(provider.providerId);
  }

  function requireProvider(providerId) {
    const provider = providerMap.get(providerId);
    if (!provider) throw workspaceError('WORKSPACE_PROVIDER_NOT_FOUND', `Workspace provider not found: ${providerId}.`);
    return provider;
  }

  function requireWorkspace(workspaceId) {
    const workspace = workspaces.get(workspaceId);
    if (!workspace) throw workspaceError('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceId}.`);
    return workspace;
  }

  function transition(workspaceId, allowedStatuses, nextStatus) {
    const workspace = requireWorkspace(workspaceId);
    if (!allowedStatuses.includes(workspace.status)) {
      throw workspaceError('WORKSPACE_TRANSITION_INVALID', `Cannot transition Workspace ${workspaceId} from ${workspace.status} to ${nextStatus}.`);
    }
    const updated = freezeWorkspace({ ...workspace, status: nextStatus, updatedAt: timestamp(), version: workspace.version + 1 });
    workspaces.set(workspaceId, updated);
    return updated;
  }

  function timestamp() {
    const value = now();
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
    return date.toISOString();
  }
}

export function createLocalWorkspaceProvider({ providerId = 'local', rootPath }) {
  if (!rootPath) throw new TypeError('rootPath is required');
  return Object.freeze({
    providerId,
    workspaceType: WorkspaceType.LOCAL,
    async create() {
      return { path: rootPath, branch: null, metadata: { shared: true } };
    },
    async release() {},
  });
}

function validateProvider(provider) {
  if (!provider?.providerId) throw new TypeError('provider.providerId is required');
  if (!Object.values(WorkspaceType).includes(provider.workspaceType)) throw new TypeError(`Invalid workspaceType: ${provider.workspaceType}.`);
  if (typeof provider.create !== 'function') throw new TypeError('provider.create must be a function');
  if (provider.release !== undefined && typeof provider.release !== 'function') throw new TypeError('provider.release must be a function when provided');
}

function freezeWorkspace(workspace) {
  return Object.freeze({ ...workspace });
}

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
