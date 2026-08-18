import { jsonString, newId, parseJson } from "../foundation/ids.js";

export class ArchiveSurfaceRepository {
  constructor(db) {
    this.db = db;
  }

  async setPolicy({ resourceType, resourceId, existenceBehavior = "not_found", catalogRule = { access: "public" }, fieldRules = {}, relationshipRule = { access: "public" } }) {
    const id = newId("vispol");
    await this.db.prepare(`
      INSERT INTO archive_visibility_policies (id, resource_type, resource_id, existence_behavior, catalog_rule_json, field_rules_json, relationship_rule_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_type, resource_id) DO UPDATE SET
        existence_behavior = excluded.existence_behavior,
        catalog_rule_json = excluded.catalog_rule_json,
        field_rules_json = excluded.field_rules_json,
        relationship_rule_json = excluded.relationship_rule_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id, resourceType, resourceId, existenceBehavior, jsonString(catalogRule), jsonString(fieldRules), jsonString(relationshipRule)).run();
    return id;
  }

  async setProtectedField({ recordId, fieldKey, value }) {
    await this.db.prepare(`
      INSERT INTO record_protected_fields (record_id, field_key, value_json)
      VALUES (?, ?, ?)
      ON CONFLICT(record_id, field_key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
    `).bind(recordId, fieldKey, jsonString(value, null)).run();
  }

  async listRecords({ recordType = null, limit = 50 } = {}) {
    const capped = Math.max(1, Math.min(Number(limit || 50), 100));
    const sql = `
      SELECT r.*, rr.body, rr.redaction_state,
        avp.existence_behavior, avp.catalog_rule_json, avp.field_rules_json
      FROM records r
      LEFT JOIN record_revisions rr ON rr.id = r.current_revision_id
      LEFT JOIN archive_visibility_policies avp ON avp.resource_type = 'record' AND avp.resource_id = r.id
      WHERE r.status = 'published' ${recordType ? "AND r.record_type = ?" : ""}
      ORDER BY r.created_at DESC
      LIMIT ?
    `;
    const rows = recordType
      ? await this.db.prepare(sql).bind(recordType, capped).all()
      : await this.db.prepare(sql).bind(capped).all();
    return (rows.results || []).map(hydrateRecord);
  }

  async findRecordBySlug(slug) {
    const row = await this.db.prepare(`
      SELECT r.*, rr.body, rr.redaction_state,
        avp.existence_behavior, avp.catalog_rule_json, avp.field_rules_json
      FROM records r
      LEFT JOIN record_revisions rr ON rr.id = r.current_revision_id
      LEFT JOIN archive_visibility_policies avp ON avp.resource_type = 'record' AND avp.resource_id = r.id
      WHERE r.slug = ? AND r.status = 'published'
      LIMIT 1
    `).bind(slug).first();
    return row ? hydrateRecord(row) : null;
  }

  async protectedFields(recordId) {
    const rows = await this.db.prepare("SELECT field_key, value_json FROM record_protected_fields WHERE record_id = ?").bind(recordId).all();
    const fields = {};
    for (const row of rows.results || []) fields[row.field_key] = parseJson(row.value_json, null);
    return fields;
  }

  async discoveries(accountId) {
    if (!accountId) return new Set();
    const rows = await this.db.prepare("SELECT discovery_key FROM account_discoveries WHERE account_id = ?").bind(accountId).all();
    return new Set((rows.results || []).map((row) => row.discovery_key));
  }

  async archiveIdentity(accountId) {
    if (!accountId) return null;
    return await this.db.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ? LIMIT 1").bind(accountId).first();
  }

  async listRelationships({ limit = 100 } = {}) {
    const capped = Math.max(1, Math.min(Number(limit || 100), 200));
    const rows = await this.db.prepare(`
      SELECT er.*, avp.existence_behavior, avp.catalog_rule_json, avp.relationship_rule_json
      FROM entity_relationships er
      LEFT JOIN archive_visibility_policies avp ON avp.resource_type = 'relationship' AND avp.resource_id = er.id
      ORDER BY er.created_at DESC
      LIMIT ?
    `).bind(capped).all();
    return (rows.results || []).map((row) => ({
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      relationshipType: row.relationship_type,
      targetType: row.target_type,
      targetId: row.target_id,
      confidence: row.confidence,
      provenance: parseJson(row.provenance_json, {}),
      policy: {
        existenceBehavior: row.existence_behavior || "not_found",
        catalogRule: parseJson(row.catalog_rule_json, { access: "public" }),
        relationshipRule: parseJson(row.relationship_rule_json, { access: "public" })
      }
    }));
  }

  async publicRecordRefsById(ids) {
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.prepare(`
      SELECT id, slug, record_type, title
      FROM records
      WHERE id IN (${placeholders})
    `).bind(...ids).all();
    return new Map((rows.results || []).map((row) => [row.id, {
      type: row.record_type,
      slug: row.slug,
      title: row.title
    }]));
  }
}

function hydrateRecord(row) {
  return {
    id: row.id,
    slug: row.slug,
    recordType: row.record_type,
    title: row.title,
    summary: row.summary,
    visibility: row.visibility,
    body: row.body || "",
    redactionState: row.redaction_state || "none",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    policy: {
      existenceBehavior: row.existence_behavior || "not_found",
      catalogRule: parseJson(row.catalog_rule_json, defaultCatalogRule(row.visibility)),
      fieldRules: parseJson(row.field_rules_json, {})
    }
  };
}

function defaultCatalogRule(visibility) {
  if (visibility === "authenticated") return { access: "authenticated" };
  if (visibility === "private" || visibility === "restricted") return { access: "unavailable" };
  return { access: "public" };
}
