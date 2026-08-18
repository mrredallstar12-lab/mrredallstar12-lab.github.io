import { jsonString, newId } from "../foundation/ids.js";

export class ContentRepository {
  constructor(db) {
    this.db = db;
  }

  async createRecord({ slug, recordType, title, summary = "", status = "draft", visibility = "public", body = "" }) {
    const recordId = newId("rec");
    const revisionId = newId("rev");
    await this.db.withTransaction(async (tx) => {
      await tx.prepare(`
        INSERT INTO records (id, slug, record_type, title, summary, status, visibility, current_revision_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(recordId, slug, recordType, title, summary, status, visibility, revisionId).run();
      await tx.prepare(`
        INSERT INTO record_revisions (id, record_id, revision_number, title, body)
        VALUES (?, ?, 1, ?, ?)
      `).bind(revisionId, recordId, title, body).run();
    });
    return recordId;
  }

  async addRelationship({ sourceType, sourceId, relationshipType, targetType, targetId, canonical = true, confidence = null, provenance = {} }) {
    const id = newId("rel");
    await this.db.prepare(`
      INSERT INTO entity_relationships (id, source_type, source_id, relationship_type, target_type, target_id, canonical, confidence, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, sourceType, sourceId, relationshipType, targetType, targetId, canonical ? 1 : 0, confidence, jsonString(provenance)).run();
    return id;
  }

  async addDiscovery({ accountId, discoveryType, discoveryKey, resourceType = null, resourceId = null, provenance = {} }) {
    const id = newId("disc");
    await this.db.prepare(`
      INSERT OR IGNORE INTO account_discoveries (id, account_id, discovery_type, discovery_key, resource_type, resource_id, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, accountId, discoveryType, discoveryKey, resourceType, resourceId, jsonString(provenance)).run();
    return id;
  }

  async addAnnotation({ accountId, resourceType, resourceId, body, tags = [] }) {
    const id = newId("anno");
    await this.db.prepare(`
      INSERT INTO account_annotations (id, account_id, resource_type, resource_id, body, tags_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, accountId, resourceType, resourceId, body, jsonString(tags, [])).run();
    return id;
  }
}
