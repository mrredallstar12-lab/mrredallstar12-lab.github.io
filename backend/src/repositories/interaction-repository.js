import { canonicalJson } from "../progression/canonical.js";

export class InteractionRepository {
  constructor(db) {
    this.db = db;
  }

  async find(sourceType, sourceSubject, idempotencyKey) {
    return await this.db.prepare(`
      SELECT * FROM canonical_interactions
      WHERE source_type = ? AND source_subject = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(sourceType, sourceSubject, idempotencyKey).first();
  }

  async insert(interaction) {
    await this.db.prepare(`
      INSERT INTO canonical_interactions (
        id, account_id, interaction_type, schema_version, source_type, source_subject,
        resource_type, resource_id, resource_revision, idempotency_key, input_digest,
        status, request_id, provenance_json, received_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)
    `).bind(
      interaction.id, interaction.accountId, interaction.interactionType,
      interaction.sourceType, interaction.sourceSubject, interaction.resourceType,
      interaction.resourceId, interaction.resourceRevision, interaction.idempotencyKey,
      interaction.inputDigest, interaction.requestId || null,
      canonicalJson(interaction.provenance || {}), interaction.receivedAt
    ).run();
  }

  async complete(id, { status = "completed", resultCode, progressionEventId = null, completedAt }) {
    await this.db.prepare(`
      UPDATE canonical_interactions
      SET status = ?, result_code = ?, progression_event_id = ?, completed_at = ?
      WHERE id = ?
    `).bind(status, resultCode, progressionEventId, completedAt, id).run();
  }
}
