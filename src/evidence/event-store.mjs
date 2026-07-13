export function createEventStore() {
  const events = [];
  const byId = new Map();
  const byIdempotencyKey = new Map();

  return Object.freeze({
    append(event) {
      validateEvent(event);
      if (byId.has(event.eventId)) {
        const existing = byId.get(event.eventId);
        if (existing.idempotencyKey !== event.idempotencyKey) {
          throw eventError('EVENT_ID_COLLISION', `eventId ${event.eventId} already exists with a different idempotencyKey.`);
        }
        return Object.freeze({ appended: false, event: existing });
      }
      if (byIdempotencyKey.has(event.idempotencyKey)) {
        return Object.freeze({ appended: false, event: byIdempotencyKey.get(event.idempotencyKey) });
      }
      const immutable = deepFreeze(structuredClone(event));
      events.push(immutable);
      byId.set(immutable.eventId, immutable);
      byIdempotencyKey.set(immutable.idempotencyKey, immutable);
      return Object.freeze({ appended: true, event: immutable });
    },

    appendMany(inputEvents) {
      if (!Array.isArray(inputEvents)) throw new TypeError('events must be an array');
      return Object.freeze(inputEvents.map((event) => this.append(event)));
    },

    get(eventId) {
      return byId.get(eventId) || null;
    },

    findByIdempotencyKey(idempotencyKey) {
      return byIdempotencyKey.get(idempotencyKey) || null;
    },

    query({ projectId = null, workflowId = null, taskId = null, eventType = null, after = null, before = null } = {}) {
      const afterTime = after ? Date.parse(after) : null;
      const beforeTime = before ? Date.parse(before) : null;
      return Object.freeze(events
        .filter((event) => !projectId || event.projectId === projectId)
        .filter((event) => !workflowId || event.workflowId === workflowId)
        .filter((event) => !taskId || event.taskId === taskId)
        .filter((event) => !eventType || event.eventType === eventType)
        .filter((event) => afterTime === null || Date.parse(event.occurredAt) > afterTime)
        .filter((event) => beforeTime === null || Date.parse(event.occurredAt) < beforeTime));
    },

    snapshot() {
      return Object.freeze([...events]);
    },

    get size() {
      return events.length;
    },
  });
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('event must be an object');
  for (const field of ['eventId', 'eventType', 'idempotencyKey', 'occurredAt', 'projectId', 'workflowId']) {
    if (!event[field]) throw new TypeError(`event.${field} is required`);
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new TypeError('event.occurredAt must be an ISO date-time');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function eventError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
