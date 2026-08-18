import { eventTypeDefinition } from "./event-registry.js";

export const EFFECT_TYPES = new Set([
  "discovery.set",
  "inventory.quantity",
  "fictional_clearance.set",
  "relationship.set",
  "archive_state.transition",
  "event.emit"
]);

export function validateEffect(effectType, effect) {
  if (!EFFECT_TYPES.has(effectType)) return failure("effect_type_unknown");
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) return failure("effect_payload_invalid");
  if (effectType === "discovery.set") {
    if (!onlyKeys(effect, ["key", "present"])) return failure("discovery_effect_invalid");
    if (!validKey(effect.key) || typeof effect.present !== "boolean") return failure("discovery_effect_invalid");
  } else if (effectType === "inventory.quantity") {
    if (!onlyKeys(effect, ["itemKey", "delta"])) return failure("inventory_effect_invalid");
    if (!validKey(effect.itemKey) || !Number.isSafeInteger(effect.delta) || effect.delta === 0 || Math.abs(effect.delta) > 1000) return failure("inventory_effect_invalid");
  } else if (effectType === "fictional_clearance.set") {
    if (!onlyKeys(effect, ["key", "present"])) return failure("fictional_clearance_effect_invalid");
    if (!validKey(effect.key) || typeof effect.present !== "boolean") return failure("fictional_clearance_effect_invalid");
  } else if (effectType === "relationship.set") {
    if (!onlyKeys(effect, ["relationshipId", "present"])) return failure("relationship_effect_invalid");
    if (!validKey(effect.relationshipId) || typeof effect.present !== "boolean") return failure("relationship_effect_invalid");
  } else if (effectType === "archive_state.transition") {
    if (!onlyKeys(effect, ["scopeType", "scopeKey", "transitionType", "set"])) return failure("archive_state_effect_invalid");
    if (!validKey(effect.scopeType) || !validKey(effect.scopeKey) || !validKey(effect.transitionType) || !plainObject(effect.set)) return failure("archive_state_effect_invalid");
  } else if (effectType === "event.emit") {
    if (!onlyKeys(effect, ["eventType", "payload"])) return failure("event_emit_effect_invalid");
    const eventDefinition = eventTypeDefinition(effect.eventType);
    if (!validKey(effect.eventType) || !eventDefinition?.sources.has("chained") || !plainObject(effect.payload)) return failure("event_emit_effect_invalid");
  }
  return { ok: true };
}

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= 4096;
}

function validKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function onlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function failure(code) {
  return { ok: false, code };
}
