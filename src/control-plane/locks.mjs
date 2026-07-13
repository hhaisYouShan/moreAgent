export function createLockManager({ now = () => Date.now() } = {}) {
  const locks = new Map();
  let version = 0;

  return Object.freeze({
    acquire({ resources, ownerId, leaseMs, metadata = {} }) {
      validateRequest(resources, ownerId, leaseMs);
      reapExpiredInternal();
      const normalized = [...new Set(resources)].sort();
      const conflicts = normalized
        .map((resource) => locks.get(resource))
        .filter((lock) => lock && lock.ownerId !== ownerId);
      if (conflicts.length) {
        return Object.freeze({
          acquired: false,
          reason: 'lock_conflict',
          conflicts: Object.freeze(conflicts.map(publicLock)),
          locks: Object.freeze([]),
        });
      }

      const acquiredAt = timestamp();
      const leaseUntil = acquiredAt + leaseMs;
      const result = [];
      for (const resource of normalized) {
        const existing = locks.get(resource);
        const record = Object.freeze({
          resource,
          ownerId,
          leaseId: existing?.leaseId || `lease-${++version}`,
          acquiredAt: existing?.acquiredAt || acquiredAt,
          heartbeatAt: acquiredAt,
          leaseUntil,
          metadata: Object.freeze({ ...metadata }),
        });
        locks.set(resource, record);
        result.push(publicLock(record));
      }
      return Object.freeze({ acquired: true, reason: null, conflicts: Object.freeze([]), locks: Object.freeze(result) });
    },

    heartbeat({ ownerId, resources = null, leaseMs }) {
      if (!ownerId) throw new TypeError('ownerId is required');
      if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new TypeError('leaseMs must be a positive integer');
      reapExpiredInternal();
      const selected = resources ? new Set(resources) : null;
      const heartbeatAt = timestamp();
      const updated = [];
      for (const [resource, lock] of locks) {
        if (lock.ownerId !== ownerId || (selected && !selected.has(resource))) continue;
        const record = Object.freeze({ ...lock, heartbeatAt, leaseUntil: heartbeatAt + leaseMs });
        locks.set(resource, record);
        updated.push(publicLock(record));
      }
      return Object.freeze(updated);
    },

    release({ ownerId, resources = null }) {
      if (!ownerId) throw new TypeError('ownerId is required');
      const selected = resources ? new Set(resources) : null;
      const released = [];
      for (const [resource, lock] of locks) {
        if (lock.ownerId !== ownerId || (selected && !selected.has(resource))) continue;
        locks.delete(resource);
        released.push(resource);
      }
      return Object.freeze(released.sort());
    },

    reapExpired() {
      return Object.freeze(reapExpiredInternal());
    },

    ownerOf(resource) {
      reapExpiredInternal();
      return locks.get(resource)?.ownerId || null;
    },

    snapshot() {
      reapExpiredInternal();
      return Object.freeze([...locks.values()].map(publicLock).sort((left, right) => left.resource.localeCompare(right.resource)));
    },
  });

  function reapExpiredInternal() {
    const current = timestamp();
    const expired = [];
    for (const [resource, lock] of locks) {
      if (lock.leaseUntil > current) continue;
      locks.delete(resource);
      expired.push(publicLock(lock));
    }
    return expired.sort((left, right) => left.resource.localeCompare(right.resource));
  }

  function timestamp() {
    const value = now();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new TypeError('now() must return milliseconds or a valid date string');
    return parsed;
  }
}

function validateRequest(resources, ownerId, leaseMs) {
  if (!Array.isArray(resources) || !resources.length || resources.some((resource) => !resource)) throw new TypeError('resources must be a non-empty string array');
  if (!ownerId) throw new TypeError('ownerId is required');
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new TypeError('leaseMs must be a positive integer');
}

function publicLock(lock) {
  return Object.freeze({
    resource: lock.resource,
    ownerId: lock.ownerId,
    leaseId: lock.leaseId,
    acquiredAt: lock.acquiredAt,
    heartbeatAt: lock.heartbeatAt,
    leaseUntil: lock.leaseUntil,
    metadata: lock.metadata,
  });
}
