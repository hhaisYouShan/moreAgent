import { createHash } from 'node:crypto';
import { ArtifactStatus } from '../domain/enums.mjs';

export function createArtifactRegistry({ now = () => new Date().toISOString() } = {}) {
  const artifacts = new Map();
  const activeByLogicalKey = new Map();
  let sequence = 0;

  return Object.freeze({
    register({
      projectId,
      workflowId,
      logicalKey,
      artifactType,
      content,
      location,
      producedBy,
      phase = null,
      taskId = null,
      sourceCommit = null,
      inputHash = null,
      metadata = {},
      activate = true,
    } = {}) {
      for (const [name, value] of Object.entries({ projectId, workflowId, logicalKey, artifactType, location, producedBy })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      const key = compoundKey(projectId, workflowId, logicalKey);
      const previousId = activeByLogicalKey.get(key) || null;
      const previous = previousId ? artifacts.get(previousId) : null;
      const version = previous ? previous.version + 1 : 1;
      const artifactId = `artifact-${++sequence}`;
      const createdAt = timestamp(now);
      const hash = hashContent(content);

      if (previous && activate) {
        const superseded = freezeArtifact({
          ...previous,
          status: ArtifactStatus.SUPERSEDED,
          supersededBy: artifactId,
          updatedAt: createdAt,
        });
        artifacts.set(previous.artifactId, superseded);
      }

      const artifact = freezeArtifact({
        schemaVersion: '1.0',
        entityType: 'ARTIFACT',
        artifactId,
        logicalKey,
        artifactType,
        version,
        status: activate ? ArtifactStatus.ACTIVE : ArtifactStatus.DRAFT,
        hash,
        projectId,
        workflowId,
        phase,
        taskId,
        producedBy,
        sourceCommit,
        inputHash,
        supersedes: previous?.artifactId || null,
        supersededBy: null,
        location,
        metadata: Object.freeze({ ...metadata }),
        createdAt,
        updatedAt: createdAt,
      });
      artifacts.set(artifactId, artifact);
      if (activate) activeByLogicalKey.set(key, artifactId);
      return artifact;
    },

    activate(artifactId) {
      const artifact = requireArtifact(artifactId);
      if ([ArtifactStatus.REJECTED, ArtifactStatus.ARCHIVED].includes(artifact.status)) {
        throw registryError('ARTIFACT_NOT_ACTIVATABLE', `Artifact ${artifactId} cannot be activated from ${artifact.status}.`);
      }
      const key = compoundKey(artifact.projectId, artifact.workflowId, artifact.logicalKey);
      const currentId = activeByLogicalKey.get(key);
      const current = currentId ? artifacts.get(currentId) : null;
      if (current && current.artifactId !== artifactId) {
        artifacts.set(current.artifactId, freezeArtifact({ ...current, status: ArtifactStatus.SUPERSEDED, supersededBy: artifactId, updatedAt: timestamp(now) }));
      }
      const updated = freezeArtifact({ ...artifact, status: ArtifactStatus.ACTIVE, supersedes: current?.artifactId || artifact.supersedes, updatedAt: timestamp(now) });
      artifacts.set(artifactId, updated);
      activeByLogicalKey.set(key, artifactId);
      return updated;
    },

    reject(artifactId, reason) {
      if (!reason) throw new TypeError('reason is required');
      const artifact = requireArtifact(artifactId);
      const updated = freezeArtifact({ ...artifact, status: ArtifactStatus.REJECTED, rejectionReason: reason, updatedAt: timestamp(now) });
      artifacts.set(artifactId, updated);
      const key = compoundKey(artifact.projectId, artifact.workflowId, artifact.logicalKey);
      if (activeByLogicalKey.get(key) === artifactId) activeByLogicalKey.delete(key);
      return updated;
    },

    archive(artifactId) {
      const artifact = requireArtifact(artifactId);
      const updated = freezeArtifact({ ...artifact, status: ArtifactStatus.ARCHIVED, updatedAt: timestamp(now) });
      artifacts.set(artifactId, updated);
      const key = compoundKey(artifact.projectId, artifact.workflowId, artifact.logicalKey);
      if (activeByLogicalKey.get(key) === artifactId) activeByLogicalKey.delete(key);
      return updated;
    },

    get(artifactId) {
      return artifacts.get(artifactId) || null;
    },

    getActive({ projectId, workflowId, logicalKey }) {
      const artifactId = activeByLogicalKey.get(compoundKey(projectId, workflowId, logicalKey));
      return artifactId ? artifacts.get(artifactId) : null;
    },

    verifyContent(artifactId, content) {
      return requireArtifact(artifactId).hash === hashContent(content);
    },

    list({ projectId = null, workflowId = null, status = null } = {}) {
      return Object.freeze([...artifacts.values()]
        .filter((artifact) => !projectId || artifact.projectId === projectId)
        .filter((artifact) => !workflowId || artifact.workflowId === workflowId)
        .filter((artifact) => !status || artifact.status === status)
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId)));
    },
  });

  function requireArtifact(artifactId) {
    const artifact = artifacts.get(artifactId);
    if (!artifact) throw registryError('ARTIFACT_NOT_FOUND', `Artifact not found: ${artifactId}.`);
    return artifact;
  }
}

export function hashContent(content) {
  const normalized = typeof content === 'string' || Buffer.isBuffer(content)
    ? content
    : JSON.stringify(content);
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function compoundKey(projectId, workflowId, logicalKey) {
  return `${projectId}:${workflowId}:${logicalKey}`;
}

function freezeArtifact(artifact) {
  return Object.freeze({ ...artifact });
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
