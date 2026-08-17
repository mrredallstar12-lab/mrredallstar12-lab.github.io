import { jsonString, newId } from "../foundation/ids.js";

export class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  async record({ actorType, actorId = null, serviceId = null, action, resourceType = null, resourceId = null, result, requestId = null, context = {} }) {
    const id = newId("audit");
    await this.db.prepare(`
      INSERT INTO audit_events (id, actor_type, actor_id, service_id, action, resource_type, resource_id, result, request_id, context_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, actorType, actorId, serviceId, action, resourceType, resourceId, result, requestId, jsonString(context)).run();
    return id;
  }

  async recent(limit = 20) {
    const rows = await this.db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?").bind(limit).all();
    return rows.results || [];
  }
}

