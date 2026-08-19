import { canonicalDigest } from "../progression/canonical.js";
import { validateCondition } from "../progression/rule-evaluator.js";
import { newId, parseJson } from "../foundation/ids.js";
import { encryptPuzzleVerifier } from "../investigations/puzzle-verifier.js";

export class InvestigationRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.fieldEncryptionKey = options.fieldEncryptionKey || "";
    this.fieldEncryptionKeyId = options.fieldEncryptionKeyId || "env:v1";
  }

  async createDefinitionVersion({
    investigationKey, caseRecordId, version = 1, status = "published", title, summary = null,
    eligibilityCondition = null, fixtureNamespace = null, createdBy = null, steps = []
  }) {
    validateOptionalCondition(eligibilityCondition);
    const record = await this.db.prepare("SELECT record_type FROM records WHERE id = ?").bind(caseRecordId).first();
    if (!record || record.record_type !== "case") throw investigationError("investigation_case_required");
    if (!validKey(investigationKey) || !Number.isSafeInteger(version) || version < 1 || !["draft", "published", "withdrawn", "retired"].includes(status)) {
      throw investigationError("investigation_definition_invalid");
    }
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 32) throw investigationError("investigation_steps_invalid");

    const existingDefinition = await this.db.prepare("SELECT id, case_record_id FROM case_investigation_definitions WHERE investigation_key = ? LIMIT 1").bind(investigationKey).first();
    if (existingDefinition && existingDefinition.case_record_id !== caseRecordId) throw investigationError("investigation_definition_conflict");
    const definitionId = existingDefinition?.id || newId("investigation");
    const versionId = newId("investigation_version");
    await this.db.withTransaction(async (tx) => {
      if (!existingDefinition) {
        await tx.prepare(`
          INSERT INTO case_investigation_definitions (id, investigation_key, case_record_id)
          VALUES (?, ?, ?)
        `).bind(definitionId, investigationKey, caseRecordId).run();
      }
      await tx.prepare(`
        INSERT INTO case_investigation_versions (
          id, definition_id, version, status, player_title, player_summary,
          eligibility_condition_json, fixture_namespace, created_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        versionId, definitionId, version, status, cleanText(title, 160), cleanNullableText(summary, 500),
        eligibilityCondition ? JSON.stringify(eligibilityCondition) : null,
        fixtureNamespace, createdBy, status === "published" ? new Date().toISOString() : null
      ).run();
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        validateStep(step);
        const normalizationVersion = step.normalizationVersion || 1;
        await tx.prepare(`
          INSERT INTO case_investigation_steps (
            id, investigation_version_id, step_key, step_order, step_kind, player_label,
            player_prompt, public_metadata_json, visibility_condition_json,
            eligibility_condition_json, verifier_ciphertext, verifier_key_id,
            normalization_version, attempt_policy_json
          ) VALUES (?, ?, ?, ?, 'exact_normalized_secret', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          newId("investigation_step"), versionId, step.stepKey, index + 1,
          cleanText(step.label, 160), cleanNullableText(step.prompt, 1000),
          JSON.stringify(step.publicMetadata || {}),
          step.visibilityCondition ? JSON.stringify(step.visibilityCondition) : null,
          step.eligibilityCondition ? JSON.stringify(step.eligibilityCondition) : null,
          encryptPuzzleVerifier(step.expectedAnswer, this.fieldEncryptionKey, this.fieldEncryptionKeyId, normalizationVersion),
          this.fieldEncryptionKeyId, normalizationVersion,
          JSON.stringify(normalizeAttemptPolicy(step.attemptPolicy))
        ).run();
      }
    });
    return { definitionId, versionId };
  }

  async publishedByCaseSlug(slug) {
    return await this.db.prepare(`
      SELECT d.id AS definition_id, d.investigation_key, d.case_record_id,
        v.id AS version_id, v.version, v.status, v.player_title, v.player_summary,
        v.eligibility_condition_json, r.slug, r.title AS case_title, r.current_revision_id
      FROM records r
      JOIN case_investigation_definitions d ON d.case_record_id = r.id
      JOIN case_investigation_versions v ON v.definition_id = d.id
      WHERE r.slug = ? AND r.status = 'published' AND v.status = 'published'
      ORDER BY v.version DESC
      LIMIT 1
    `).bind(slug).first();
  }

  async hasPublishedForCaseRecord(caseRecordId) {
    const row = await this.db.prepare(`
      SELECT 1 AS available
      FROM case_investigation_definitions d
      JOIN case_investigation_versions v ON v.definition_id = d.id
      WHERE d.case_record_id = ? AND v.status = 'published'
      LIMIT 1
    `).bind(caseRecordId).first();
    return !!row?.available;
  }

  async versionForAccountAndCase(accountId, slug) {
    return await this.db.prepare(`
      SELECT d.id AS definition_id, d.investigation_key, d.case_record_id,
        v.id AS version_id, v.version, v.status AS version_status, v.player_title, v.player_summary,
        v.eligibility_condition_json, r.slug, r.title AS case_title, r.current_revision_id,
        a.id AS account_investigation_id, a.status AS account_status, a.started_at,
        a.resolved_at, a.last_activity_at
      FROM records r
      JOIN case_investigation_definitions d ON d.case_record_id = r.id
      JOIN case_investigation_versions v ON v.definition_id = d.id
      JOIN account_case_investigations a ON a.investigation_version_id = v.id AND a.account_id = ?
      WHERE r.slug = ? AND r.status = 'published'
      ORDER BY a.started_at DESC
      LIMIT 1
    `).bind(accountId, slug).first();
  }

  async start({ accountId, versionId, startedAt }) {
    const id = newId("account_investigation");
    await this.db.prepare(`
      INSERT INTO account_case_investigations (
        id, account_id, investigation_version_id, status, started_at, last_activity_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(account_id, investigation_version_id) DO NOTHING
    `).bind(id, accountId, versionId, startedAt, startedAt).run();
    return await this.db.prepare(`
      SELECT * FROM account_case_investigations
      WHERE account_id = ? AND investigation_version_id = ? LIMIT 1
    `).bind(accountId, versionId).first();
  }

  async runByAccountVersion(accountId, versionId) {
    return await this.db.prepare(`
      SELECT * FROM account_case_investigations
      WHERE account_id = ? AND investigation_version_id = ? LIMIT 1
    `).bind(accountId, versionId).first();
  }

  async step(versionId, stepKey) {
    return await this.db.prepare(`
      SELECT * FROM case_investigation_steps
      WHERE investigation_version_id = ? AND step_key = ? LIMIT 1
    `).bind(versionId, stepKey).first();
  }

  async steps(versionId) {
    const rows = await this.db.prepare(`
      SELECT * FROM case_investigation_steps
      WHERE investigation_version_id = ? ORDER BY step_order, step_key
    `).bind(versionId).all();
    return rows.results || [];
  }

  async resolution(accountInvestigationId, stepId) {
    return await this.db.prepare(`
      SELECT * FROM case_investigation_resolutions
      WHERE account_investigation_id = ? AND step_version_id = ? LIMIT 1
    `).bind(accountInvestigationId, stepId).first();
  }

  async attemptByFingerprint(accountInvestigationId, stepId, fingerprint) {
    return await this.db.prepare(`
      SELECT * FROM case_investigation_attempts
      WHERE account_investigation_id = ? AND step_version_id = ? AND submission_fingerprint = ? LIMIT 1
    `).bind(accountInvestigationId, stepId, fingerprint).first();
  }

  async recentAttemptCount(accountInvestigationId, stepId, since) {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS count FROM case_investigation_attempts
      WHERE account_investigation_id = ? AND step_version_id = ? AND created_at >= ?
    `).bind(accountInvestigationId, stepId, since).first();
    return Number(row?.count || 0);
  }

  async insertAttempt({ id, accountInvestigationId, stepId, interactionId, fingerprint, outcome, requestId, provenance, createdAt }) {
    const ordinal = Number((await this.db.prepare(`
      SELECT COALESCE(MAX(attempt_ordinal), 0) AS ordinal FROM case_investigation_attempts
      WHERE account_investigation_id = ? AND step_version_id = ?
    `).bind(accountInvestigationId, stepId).first())?.ordinal || 0) + 1;
    await this.db.prepare(`
      INSERT INTO case_investigation_attempts (
        id, account_investigation_id, step_version_id, interaction_id,
        submission_fingerprint, outcome, attempt_ordinal, request_id, provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, accountInvestigationId, stepId, interactionId, fingerprint, outcome,
      ordinal, requestId || null, JSON.stringify(provenance || {}), createdAt
    ).run();
    return { id, ordinal };
  }

  async resolve({ accountInvestigationId, stepId, attemptId, progressionEventId, resolvedAt }) {
    await this.db.prepare(`
      INSERT INTO case_investigation_resolutions (
        account_investigation_id, step_version_id, accepted_attempt_id, progression_event_id, resolved_at
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(accountInvestigationId, stepId, attemptId, progressionEventId, resolvedAt).run();
    const unresolved = await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM case_investigation_steps s
      JOIN account_case_investigations a ON a.investigation_version_id = s.investigation_version_id
      LEFT JOIN case_investigation_resolutions r
        ON r.account_investigation_id = a.id AND r.step_version_id = s.id
      WHERE a.id = ? AND r.step_version_id IS NULL
    `).bind(accountInvestigationId).first();
    await this.db.prepare(`
      UPDATE account_case_investigations
      SET status = ?, resolved_at = ?, last_activity_at = ?
      WHERE id = ?
    `).bind(Number(unresolved?.count || 0) === 0 ? "resolved" : "active", Number(unresolved?.count || 0) === 0 ? resolvedAt : null, resolvedAt, accountInvestigationId).run();
  }

  async touch(accountInvestigationId, at) {
    await this.db.prepare("UPDATE account_case_investigations SET last_activity_at = ? WHERE id = ?").bind(at, accountInvestigationId).run();
  }

  async pin({ accountInvestigationId, accountId, targetType, targetId, publicRef, interactionId, pinnedAt }) {
    const id = newId("evidence_pin");
    await this.db.prepare(`
      INSERT INTO case_evidence_pins (
        id, account_investigation_id, account_id, target_type, target_id,
        public_ref, interaction_id, status, pinned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).bind(id, accountInvestigationId, accountId, targetType, targetId, publicRef, interactionId, pinnedAt).run();
    return { id, publicRef };
  }

  async pinForTarget(accountInvestigationId, targetType, targetId) {
    return await this.db.prepare(`
      SELECT * FROM case_evidence_pins
      WHERE account_investigation_id = ? AND target_type = ? AND target_id = ? LIMIT 1
    `).bind(accountInvestigationId, targetType, targetId).first();
  }

  async repin(id, interactionId, at) {
    await this.db.prepare(`
      UPDATE case_evidence_pins
      SET status = 'active', pinned_at = ?, unpinned_at = NULL, interaction_id = ?
      WHERE id = ?
    `).bind(at, interactionId, id).run();
  }

  async pinByPublicRef(accountId, accountInvestigationId, publicRef) {
    return await this.db.prepare(`
      SELECT * FROM case_evidence_pins
      WHERE account_id = ? AND account_investigation_id = ? AND public_ref = ? AND status = 'active'
      LIMIT 1
    `).bind(accountId, accountInvestigationId, publicRef).first();
  }

  async unpin(id, at) {
    await this.db.prepare(`
      UPDATE case_evidence_pins SET status = 'unpinned', unpinned_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(at, id).run();
  }

  async pins(accountInvestigationId) {
    const rows = await this.db.prepare(`
      SELECT p.*, r.slug AS record_slug, r.title AS record_title,
        d.item_key, d.name AS item_name,
        instance_definition.name AS instance_name,
        rel.relationship_type, source_record.title AS relationship_source_title,
        target_record.title AS relationship_target_title
      FROM case_evidence_pins p
      LEFT JOIN records r ON p.target_type = 'record' AND r.id = p.target_id
      LEFT JOIN inventory_item_definitions d ON p.target_type = 'inventory_definition' AND d.id = p.target_id
      LEFT JOIN inventory_item_instances instance ON p.target_type = 'inventory_instance' AND instance.id = p.target_id
      LEFT JOIN inventory_item_definitions instance_definition ON instance_definition.id = instance.item_definition_id
      LEFT JOIN entity_relationships rel ON p.target_type = 'relationship' AND rel.id = p.target_id
      LEFT JOIN records source_record ON rel.source_type = 'record' AND source_record.id = rel.source_id
      LEFT JOIN records target_record ON rel.target_type = 'record' AND target_record.id = rel.target_id
      WHERE p.account_investigation_id = ? AND p.status = 'active'
      ORDER BY p.pinned_at, p.id
    `).bind(accountInvestigationId).all();
    return rows.results || [];
  }

  async activeForAccount(accountId) {
    const rows = await this.db.prepare(`
      SELECT a.id AS account_investigation_id, a.status AS account_status, a.started_at,
        a.resolved_at, a.last_activity_at, v.id AS version_id, v.version,
        v.player_title, v.player_summary, d.investigation_key, d.case_record_id,
        r.slug, r.title AS case_title
      FROM account_case_investigations a
      JOIN case_investigation_versions v ON v.id = a.investigation_version_id
      JOIN case_investigation_definitions d ON d.id = v.definition_id
      JOIN records r ON r.id = d.case_record_id
      WHERE a.account_id = ?
      ORDER BY a.last_activity_at DESC, a.id
      LIMIT 25
    `).bind(accountId).all();
    return rows.results || [];
  }

  async heldInventoryDefinition(accountId, itemKey) {
    return await this.db.prepare(`
      SELECT d.id, d.item_key, d.name
      FROM inventory_item_definitions d
      LEFT JOIN inventory_balances b ON b.item_definition_id = d.id AND b.account_id = ? AND b.quantity > 0
      LEFT JOIN inventory_item_instances i ON i.item_definition_id = d.id AND i.owner_account_id = ?
      WHERE d.item_key = ? AND (b.account_id IS NOT NULL OR i.owner_account_id IS NOT NULL)
      LIMIT 1
    `).bind(accountId, accountId, itemKey).first();
  }

  async heldInventoryInstance(accountId, instanceRef) {
    return await this.db.prepare(`
      SELECT i.id, d.name FROM inventory_item_instances i
      JOIN inventory_item_definitions d ON d.id = i.item_definition_id
      WHERE i.id = ? AND i.owner_account_id = ? LIMIT 1
    `).bind(instanceRef, accountId).first();
  }

  publicVersion(row) {
    return canonicalDigest({ investigationKey: row.investigation_key, version: row.version });
  }
}

function validateStep(step) {
  if (!step || step.kind && step.kind !== "exact_normalized_secret") throw investigationError("investigation_step_kind_invalid");
  if (!validKey(step.stepKey)) throw investigationError("investigation_step_key_invalid");
  validateOptionalCondition(step.visibilityCondition);
  validateOptionalCondition(step.eligibilityCondition);
  normalizeAttemptPolicy(step.attemptPolicy);
}

function validateOptionalCondition(condition) {
  if (condition === null || condition === undefined) return;
  const result = validateCondition(condition);
  if (!result.ok) throw investigationError("investigation_condition_invalid", { errors: result.errors });
}

function normalizeAttemptPolicy(value = {}) {
  const limit = value?.maxAttemptsPerHour ?? 6;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw investigationError("attempt_policy_invalid");
  return { maxAttemptsPerHour: limit };
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw investigationError("investigation_text_invalid");
  return text;
}

function cleanNullableText(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return cleanText(value, maxLength);
}

function validKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function investigationError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

export function safeStep(row, resolved = false) {
  return {
    stepKey: row.step_key,
    label: row.player_label,
    prompt: row.player_prompt || null,
    publicMetadata: parseJson(row.public_metadata_json, {}),
    resolved
  };
}
