import { SessionStatus } from '../domain/enums.mjs';

export function createSessionManager({ now = () => new Date().toISOString(), staleAfterMs = 60_000 } = {}) {
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) throw new TypeError('staleAfterMs must be a positive integer');
  const sessions = new Map();
  let sequence = 0;

  return Object.freeze({
    create({ agentId, runnerId, externalSessionId = null, metadata = {} }) {
      if (!agentId) throw new TypeError('agentId is required');
      if (!runnerId) throw new TypeError('runnerId is required');
      const createdAt = timestamp();
      const session = freezeSession({
        schemaVersion: '1.0',
        entityType: 'SESSION',
        sessionId: `session-${++sequence}`,
        agentId,
        status: SessionStatus.ACTIVE,
        runnerType: runnerId,
        externalSessionId,
        createdAt,
        lastHeartbeatAt: createdAt,
        closedAt: null,
        metadata: Object.freeze({ ...metadata }),
        version: 1,
      });
      sessions.set(session.sessionId, session);
      return session;
    },

    resume(sessionId) {
      const session = requireSession(sessionId);
      if (session.status === SessionStatus.CLOSED) throw sessionError('SESSION_CLOSED', `Session is closed: ${sessionId}.`);
      const resumed = freezeSession({ ...session, status: SessionStatus.ACTIVE, lastHeartbeatAt: timestamp(), version: session.version + 1 });
      sessions.set(sessionId, resumed);
      return resumed;
    },

    heartbeat(sessionId) {
      const session = requireSession(sessionId);
      if (session.status === SessionStatus.CLOSED) throw sessionError('SESSION_CLOSED', `Session is closed: ${sessionId}.`);
      const updated = freezeSession({ ...session, status: SessionStatus.ACTIVE, lastHeartbeatAt: timestamp(), version: session.version + 1 });
      sessions.set(sessionId, updated);
      return updated;
    },

    markIdle(sessionId) {
      const session = requireSession(sessionId);
      if (session.status === SessionStatus.CLOSED) return session;
      const updated = freezeSession({ ...session, status: SessionStatus.IDLE, lastHeartbeatAt: timestamp(), version: session.version + 1 });
      sessions.set(sessionId, updated);
      return updated;
    },

    close(sessionId) {
      const session = requireSession(sessionId);
      if (session.status === SessionStatus.CLOSED) return session;
      const closedAt = timestamp();
      const updated = freezeSession({ ...session, status: SessionStatus.CLOSED, lastHeartbeatAt: closedAt, closedAt, version: session.version + 1 });
      sessions.set(sessionId, updated);
      return updated;
    },

    reapStale() {
      const current = toMillis(timestamp());
      const stale = [];
      for (const [sessionId, session] of sessions) {
        if (![SessionStatus.ACTIVE, SessionStatus.IDLE].includes(session.status)) continue;
        if (current - toMillis(session.lastHeartbeatAt) <= staleAfterMs) continue;
        const updated = freezeSession({ ...session, status: SessionStatus.STALE, version: session.version + 1 });
        sessions.set(sessionId, updated);
        stale.push(updated);
      }
      return Object.freeze(stale.sort((left, right) => left.sessionId.localeCompare(right.sessionId)));
    },

    get(sessionId) {
      return sessions.get(sessionId) || null;
    },

    list() {
      return Object.freeze([...sessions.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId)));
    },
  });

  function requireSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw sessionError('SESSION_NOT_FOUND', `Session not found: ${sessionId}.`);
    return session;
  }

  function timestamp() {
    const value = now();
    if (typeof value === 'number') return new Date(value).toISOString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new TypeError('now() must return a valid date value');
    return parsed.toISOString();
  }
}

function freezeSession(session) {
  return Object.freeze({ ...session });
}

function toMillis(value) {
  return new Date(value).getTime();
}

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
