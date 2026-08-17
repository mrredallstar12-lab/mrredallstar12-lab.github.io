import { jsonString, newId } from "../foundation/ids.js";

export class LegacyImportRepository {
  constructor(db) {
    this.db = db;
  }

  async createBatch({ accountId = null, visitorLabel = null, sourceSummary = {}, trustLevel = "untrusted" } = {}) {
    const id = newId("legacy");
    await this.db.prepare(`
      INSERT INTO legacy_import_batches (id, account_id, visitor_label, trust_level, source_summary_json)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, accountId, visitorLabel, trustLevel, jsonString(sourceSummary)).run();
    return id;
  }

  async addItem({ batchId, sourceKey, sourceType, proposedValue = {}, trustDecision = "pending", decisionReason = null }) {
    const id = newId("legacyitem");
    await this.db.prepare(`
      INSERT INTO legacy_import_items (id, batch_id, source_key, source_type, proposed_value_json, trust_decision, decision_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, batchId, sourceKey, sourceType, jsonString(proposedValue), trustDecision, decisionReason).run();
    return id;
  }
}

