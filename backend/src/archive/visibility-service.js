import { parseJson } from "../foundation/ids.js";
import { canonicalDigest } from "../progression/canonical.js";

export function buildActorContext({ accountId = null, discoveries = new Set(), archiveIdentity = null } = {}) {
  const clearance = parseJson(archiveIdentity?.clearance_state_json || "{}", {});
  return {
    authenticated: !!accountId,
    accountId,
    discoveries,
    clearance
  };
}

export function allows(rule = {}, actor = buildActorContext()) {
  const access = rule.access || "public";
  if (access === "public") return true;
  if (access === "authenticated") return actor.authenticated;
  if (access === "discovered") return actor.authenticated && actor.discoveries.has(rule.discoveryKey);
  if (access === "fictional_clearance") return actor.authenticated && hasClearance(actor.clearance, rule.clearanceKey);
  if (access === "withheld" || access === "redacted" || access === "unavailable") return false;
  return false;
}

export function unauthorizedResponseShape(policy = {}) {
  const behavior = policy.existenceBehavior || "not_found";
  if (behavior === "known_restricted") {
    return { status: 403, body: { ok: false, error: { code: "restricted", message: "Record exists but is unavailable to this session." } } };
  }
  if (behavior === "catalog_stub") return { status: 200, body: null };
  return { status: 404, body: { ok: false, error: { code: "not_found", message: "Archive record not found." } } };
}

export async function filterRecord(record, actor, repo, { detail = false } = {}) {
  const policy = record.policy || {};
  const canSeeCatalog = allows(policy.catalogRule, actor);
  if (!canSeeCatalog && policy.existenceBehavior !== "catalog_stub") return { visible: false, shape: unauthorizedResponseShape(policy) };

  const fieldRules = policy.fieldRules || {};
  const protectedFields = detail ? await repo.protectedFields(record.id) : {};
  const out = {
    catalogId: record.slug,
    slug: record.slug,
    type: record.recordType,
    title: record.title,
    summary: canSeeCatalog ? record.summary : null,
    access: {
      catalog: canSeeCatalog ? "available" : "restricted_stub",
      detail: "partial"
    },
    fields: {}
  };

  if (!canSeeCatalog) return { visible: true, record: out };

  const bodyRule = fieldRules.body || { access: record.visibility === "public" ? "public" : "authenticated" };
  if (detail && allows(bodyRule, actor)) {
    out.fields.body = record.body;
  } else if (detail && bodyRule.redactedValue !== undefined) {
    out.fields.body = bodyRule.redactedValue;
  }

  for (const [fieldKey, value] of Object.entries(protectedFields)) {
    const rule = fieldRules[fieldKey] || { access: "withheld" };
    if (allows(rule, actor)) out.fields[fieldKey] = value;
    else if (rule.redactedValue !== undefined) out.fields[fieldKey] = rule.redactedValue;
  }

  out.access.detail = detailAccess(out.fields, protectedFields, detail);
  return { visible: true, record: out };
}

export async function filterRelationships(relationships, actor, repo) {
  const visible = [];
  for (const relationship of relationships) {
    if (!allows(relationship.policy.relationshipRule || relationship.policy.catalogRule, actor)) continue;
    visible.push(relationship);
  }

  const recordIds = Array.from(new Set(visible.flatMap((rel) => [
    rel.sourceType === "record" ? rel.sourceId : null,
    rel.targetType === "record" ? rel.targetId : null
  ]).filter(Boolean)));
  const refs = await repo.publicRecordRefsById(recordIds);

  return visible.map((rel) => ({
    relationshipRef: relationshipPublicRef(rel.id),
    source: relationshipEndpoint(rel.sourceType, rel.sourceId, refs),
    relationship: rel.relationshipType,
    target: relationshipEndpoint(rel.targetType, rel.targetId, refs),
    confidence: rel.confidence || null
  })).filter((rel) => rel.source && rel.target);
}

export function relationshipPublicRef(internalId) {
  return `relationship_${canonicalDigest({ relationship: internalId }).slice(0, 32)}`;
}

function hasClearance(clearance, key) {
  if (!key) return false;
  if (Array.isArray(clearance.clearances)) return clearance.clearances.includes(key);
  return clearance[key] === true;
}

function detailAccess(fields, protectedFields, detail) {
  if (!detail) return "catalog_only";
  const protectedCount = Object.keys(protectedFields).length;
  if (fields.body !== undefined && Object.keys(fields).length >= protectedCount + 1) return "full";
  if (Object.keys(fields).length > 0) return "partial";
  return "withheld";
}

function relationshipEndpoint(type, id, refs) {
  if (type === "record") {
    const ref = refs.get(id);
    if (!ref) return null;
    return { type: ref.type, catalogId: ref.slug, title: ref.title };
  }
  return { type, catalogId: "withheld" };
}
