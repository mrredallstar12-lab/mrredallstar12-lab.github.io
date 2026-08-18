const EVENT_TYPES = new Map([
  ["archive.record.accessed", {
    sources: new Set(["server"]),
    environments: new Set(["development", "staging", "test", "production"]),
    fields: { catalogId: { type: "string", maxLength: 96 } }
  }],
  ["archive.record.reviewed", {
    sources: new Set(["browser_session"]),
    environments: new Set(["development", "staging", "test", "production"]),
    fields: {
      catalogId: { type: "string", maxLength: 96 },
      revision: { type: "string", maxLength: 128 }
    }
  }],
  ["phase6.staging.observation", stagingEvent({
    signalKey: { type: "string", maxLength: 64 },
    sequence: { type: "integer", min: 0, max: 1000000 }
  }, ["staging_admin"])],
  ["phase6.staging.followup", stagingEvent({ marker: { type: "string", maxLength: 64 } }, ["chained"])],
  ["phase6.staging.chain.1", stagingEvent({}, ["staging_admin", "chained"])],
  ["phase6.staging.chain.2", stagingEvent({}, ["chained"])],
  ["phase6.staging.chain.3", stagingEvent({}, ["chained"])],
  ["phase6.staging.chain.4", stagingEvent({}, ["chained"])],
  ["phase6.staging.chain.5", stagingEvent({}, ["chained"])],
  ["phase6.staging.chain.6", stagingEvent({}, ["chained"])],
  ["phase6.staging.rollback", stagingEvent({}, ["staging_admin"])]
]);

function stagingEvent(fields, sources) {
  return {
    sources: new Set(sources),
    environments: new Set(["development", "staging", "test"]),
    fields
  };
}

export function eventTypeDefinition(eventType) {
  return EVENT_TYPES.get(eventType) || null;
}

export function validateAndCanonicalizeEvent({ eventType, sourceType, environment, payload }) {
  const definition = eventTypeDefinition(eventType);
  if (!definition) return failure("unknown_event_type");
  if (!definition.sources.has(sourceType)) return failure("event_source_forbidden");
  if (!definition.environments.has(environment)) return failure("event_environment_forbidden");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return failure("invalid_event_payload");

  const allowed = new Set(Object.keys(definition.fields));
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) return failure("unknown_event_payload_field", { field: key });
  }

  const canonical = {};
  for (const [key, rule] of Object.entries(definition.fields)) {
    if (!(key in payload)) return failure("missing_event_payload_field", { field: key });
    const value = payload[key];
    if (rule.type === "string") {
      if (typeof value !== "string" || value.length < 1 || value.length > rule.maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
        return failure("invalid_event_payload_field", { field: key });
      }
      canonical[key] = value;
    } else if (rule.type === "integer") {
      if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) return failure("invalid_event_payload_field", { field: key });
      canonical[key] = value;
    }
  }
  return { ok: true, payload: canonical, definition };
}

function failure(code, detail = {}) {
  return { ok: false, code, detail };
}
