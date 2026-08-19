import { randomUUID } from "node:crypto";
import { buildActorContext, filterRecord, filterRelationships, relationshipPublicRef } from "../archive/visibility-service.js";
import { newId, parseJson } from "../foundation/ids.js";
import { verifyPuzzleAnswer } from "../investigations/puzzle-verifier.js";
import { canonicalDigest } from "../progression/canonical.js";
import { ProgressionEngine } from "../progression/engine.js";
import { evaluateCondition } from "../progression/rule-evaluator.js";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { InteractionRepository } from "../repositories/interaction-repository.js";
import { InvestigationRepository } from "../repositories/investigation-repository.js";
import { ProgressionRepository } from "../repositories/progression-repository.js";
import { validateInteractionCommand } from "./interaction-registry.js";

export class CanonicalInteractionService {
  constructor(db, options = {}) {
    this.db = db;
    this.environment = options.environment || "production";
    this.fieldEncryptionKey = options.fieldEncryptionKey || "";
    this.clock = options.clock || (() => new Date());
  }

  async reviewRecord({ accountId, record, requestId = null, sourceType = "browser_session" }) {
    this.validate("archive.record.review", sourceType, {});
    const revision = record.currentRevisionId || record.updatedAt;
    const idempotencyKey = `review:${record.id}:${revision}`;
    return await this.db.withTransaction(async (tx) => {
      const interactions = new InteractionRepository(tx);
      const interaction = await ensureInteraction(interactions, {
        accountId, commandType: "archive.record.review", sourceType, resourceType: "record",
        resourceId: record.id, resourceRevision: revision, idempotencyKey, input: {}, requestId,
        provenance: { source: "authenticated_record_review" }, now: this.now()
      });
      const progression = await new ProgressionEngine(tx, { environment: this.environment, clock: this.clock }).ingestInTransaction({
        eventType: "archive.record.reviewed",
        sourceType: "browser_session",
        sourceSubject: accountId,
        accountId,
        idempotencyKey,
        payload: { catalogId: record.slug, revision },
        provenance: { source: "authenticated_record_review", recordId: record.id },
        requestId
      });
      await interactions.complete(interaction.id, {
        resultCode: progression.duplicate ? "already_reviewed" : "reviewed",
        progressionEventId: progression.rootEventId,
        completedAt: this.now()
      });
      return progression;
    });
  }

  async startInvestigation({ accountId, caseSlug, requestId = null, sourceType = "browser_session" }) {
    this.validate("archive.case.investigation.start", sourceType, {});
    const authored = new InvestigationRepository(this.db, this.repositoryOptions());
    const version = await authored.publishedByCaseSlug(caseSlug);
    if (!version) throw interactionError("not_found");
    await this.requireVisibleRecord(accountId, caseSlug);
    await this.requireCondition(accountId, version.eligibility_condition_json);
    const idempotencyKey = `start:${version.version_id}`;
    return await this.db.withTransaction(async (tx) => {
      const interactions = new InteractionRepository(tx);
      const investigations = new InvestigationRepository(tx, this.repositoryOptions());
      const interaction = await ensureInteraction(interactions, {
        accountId, commandType: "archive.case.investigation.start", sourceType,
        resourceType: "case_investigation", resourceId: version.definition_id,
        resourceRevision: String(version.version), idempotencyKey, input: {}, requestId,
        provenance: { caseSlug }, now: this.now()
      });
      const existing = await investigations.runByAccountVersion(accountId, version.version_id);
      const run = await investigations.start({ accountId, versionId: version.version_id, startedAt: this.now() });
      await interactions.complete(interaction.id, { resultCode: existing ? "already_started" : "started", completedAt: this.now() });
      return { duplicate: !!existing, caseSlug, investigationVersion: investigations.publicVersion(version), status: run.status };
    });
  }

  async pinEvidence({ accountId, caseSlug, targetType, catalogId, requestId = null, sourceType = "browser_session" }) {
    const validated = this.validate("archive.case.evidence.pin", sourceType, { targetType, catalogId });
    const run = await this.requireRun(accountId, caseSlug);
    if (run.account_status !== "active") throw interactionError("investigation_closed");
    const target = await this.resolveEvidenceTarget(accountId, validated.input.targetType, validated.input.catalogId);
    const idempotencyKey = `pin:${canonicalDigest({ run: run.account_investigation_id, targetType: target.type, targetId: target.id })}`;
    return await this.db.withTransaction(async (tx) => {
      const interactions = new InteractionRepository(tx);
      const investigations = new InvestigationRepository(tx, this.repositoryOptions());
      const prior = await investigations.pinForTarget(run.account_investigation_id, target.type, target.id);
      const interaction = await ensureInteraction(interactions, {
        accountId, commandType: "archive.case.evidence.pin", sourceType,
        resourceType: "case_evidence", resourceId: target.id, resourceRevision: String(run.version),
        idempotencyKey, input: { targetType: target.type, catalogId: target.catalogId }, requestId,
        provenance: { caseSlug }, now: this.now()
      });
      let publicRef = prior?.public_ref;
      if (!prior) {
        publicRef = `evidence_${randomUUID()}`;
        await investigations.pin({
          accountInvestigationId: run.account_investigation_id, accountId, targetType: target.type,
          targetId: target.id, publicRef, interactionId: interaction.id, pinnedAt: this.now()
        });
      } else if (prior.status !== "active") {
        await investigations.repin(prior.id, interaction.id, this.now());
      }
      await interactions.complete(interaction.id, { resultCode: prior?.status === "active" ? "already_pinned" : "pinned", completedAt: this.now() });
      return {
        duplicate: prior?.status === "active",
        evidence: { publicRef, targetType: target.type, catalogId: target.catalogId, label: target.label }
      };
    });
  }

  async unpinEvidence({ accountId, caseSlug, publicRef, requestId = null, sourceType = "browser_session" }) {
    this.validate("archive.case.evidence.unpin", sourceType, { publicRef });
    const run = await this.requireRun(accountId, caseSlug);
    if (run.account_status !== "active") throw interactionError("investigation_closed");
    return await this.db.withTransaction(async (tx) => {
      const investigations = new InvestigationRepository(tx, this.repositoryOptions());
      const pin = await investigations.pinByPublicRef(accountId, run.account_investigation_id, publicRef);
      if (!pin) throw interactionError("evidence_not_found");
      const interactions = new InteractionRepository(tx);
      const interaction = await ensureInteraction(interactions, {
        accountId, commandType: "archive.case.evidence.unpin", sourceType,
        resourceType: "case_evidence", resourceId: pin.id, resourceRevision: String(run.version),
        idempotencyKey: `unpin:${pin.id}:${pin.pinned_at}`, input: { publicRef }, requestId,
        provenance: { caseSlug }, now: this.now()
      });
      await investigations.unpin(pin.id, this.now());
      await interactions.complete(interaction.id, { resultCode: "unpinned", completedAt: this.now() });
      return { duplicate: false, publicRef };
    });
  }

  async attemptStep({ accountId, caseSlug, stepKey, answer, requestId = null, sourceType = "browser_session" }) {
    let submittedAnswer = answer;
    try {
      submittedAnswer = this.validate("archive.case.step.attempt", sourceType, { answer }).input.answer;
    } catch (error) {
      if (error.code !== "interaction_input_invalid") throw error;
    }
    const run = await this.requireRun(accountId, caseSlug);
    const authored = new InvestigationRepository(this.db, this.repositoryOptions());
    const step = await authored.step(run.version_id, stepKey);
    if (!step) throw interactionError("not_found");
    await this.requireCondition(accountId, step.eligibility_condition_json);
    const verification = verifyPuzzleAnswer({
      answer: submittedAnswer,
      verifierCiphertext: step.verifier_ciphertext,
      keyBase64: this.fieldEncryptionKey,
      normalizationVersion: Number(step.normalization_version)
    });
    if (!verification.validInput) return { accepted: false, duplicate: false, limited: false };

    return await this.db.withTransaction(async (tx) => {
      const investigations = new InvestigationRepository(tx, this.repositoryOptions());
      const replay = await investigations.attemptByFingerprint(run.account_investigation_id, step.id, verification.fingerprint);
      if (replay) return { accepted: replay.outcome === "accepted", duplicate: true, limited: false };
      const policy = parseJson(step.attempt_policy_json, { maxAttemptsPerHour: 6 });
      const since = new Date(this.clock().getTime() - 60 * 60 * 1000).toISOString();
      if (await investigations.recentAttemptCount(run.account_investigation_id, step.id, since) >= Number(policy.maxAttemptsPerHour || 6)) {
        return { accepted: false, duplicate: false, limited: true };
      }

      const interactions = new InteractionRepository(tx);
      const idempotencyKey = `attempt:${canonicalDigest({ run: run.account_investigation_id, step: step.id, fingerprint: verification.fingerprint })}`;
      const interaction = await ensureInteraction(interactions, {
        accountId, commandType: "archive.case.step.attempt", sourceType,
        resourceType: "case_investigation_step", resourceId: step.id,
        resourceRevision: String(run.version), idempotencyKey,
        input: { submissionFingerprint: verification.fingerprint }, requestId,
        provenance: { caseSlug, stepKey }, now: this.now()
      });
      const attempt = await investigations.insertAttempt({
        id: newId("investigation_attempt"), accountInvestigationId: run.account_investigation_id,
        stepId: step.id, interactionId: interaction.id, fingerprint: verification.fingerprint,
        outcome: verification.accepted ? "accepted" : "incorrect", requestId,
        provenance: { source: "typed_interaction" }, createdAt: this.now()
      });
      if (!verification.accepted) {
        await investigations.touch(run.account_investigation_id, this.now());
        await interactions.complete(interaction.id, { resultCode: "not_resolved", completedAt: this.now() });
        return { accepted: false, duplicate: false, limited: false };
      }

      const progression = await new ProgressionEngine(tx, { environment: this.environment, clock: this.clock }).ingestInTransaction({
        eventType: "archive.case.step.resolved",
        sourceType: "interaction_service",
        sourceSubject: accountId,
        accountId,
        idempotencyKey: `resolve:${canonicalDigest({ accountId, run: run.account_investigation_id, step: step.id })}`,
        payload: { caseCatalogId: caseSlug, investigationVersion: authored.publicVersion(run), stepKey },
        provenance: { source: "canonical_interaction", interactionId: interaction.id },
        requestId
      });
      await investigations.resolve({
        accountInvestigationId: run.account_investigation_id, stepId: step.id,
        attemptId: attempt.id, progressionEventId: progression.rootEventId, resolvedAt: this.now()
      });
      await interactions.complete(interaction.id, { resultCode: "resolved", progressionEventId: progression.rootEventId, completedAt: this.now() });
      return { accepted: true, duplicate: progression.duplicate, limited: false };
    });
  }

  validate(commandType, sourceType, input) {
    const result = validateInteractionCommand({ commandType, sourceType, environment: this.environment, input });
    if (!result.ok) throw interactionError(result.code);
    return result;
  }

  async requireRun(accountId, caseSlug) {
    await this.requireVisibleRecord(accountId, caseSlug);
    const run = await new InvestigationRepository(this.db, this.repositoryOptions()).versionForAccountAndCase(accountId, caseSlug);
    if (!run) throw interactionError("investigation_not_started");
    return run;
  }

  async requireVisibleRecord(accountId, slug) {
    const archive = new ArchiveSurfaceRepository(this.db);
    const record = await archive.findRecordBySlug(slug);
    if (!record || record.recordType !== "case") throw interactionError("not_found");
    const actor = buildActorContext({
      accountId,
      discoveries: await archive.discoveries(accountId),
      archiveIdentity: await archive.archiveIdentity(accountId)
    });
    const visible = await filterRecord(record, actor, archive, { detail: true });
    if (!visible.visible || visible.record?.access?.catalog !== "available") throw interactionError("not_found");
    return record;
  }

  async resolveEvidenceTarget(accountId, targetType, catalogId) {
    if (targetType === "record") {
      const archive = new ArchiveSurfaceRepository(this.db);
      const record = await archive.findRecordBySlug(catalogId);
      if (!record) throw interactionError("evidence_not_found");
      const actor = buildActorContext({
        accountId,
        discoveries: await archive.discoveries(accountId),
        archiveIdentity: await archive.archiveIdentity(accountId)
      });
      const visible = await filterRecord(record, actor, archive, { detail: false });
      if (!visible.visible) throw interactionError("evidence_not_found");
      return { type: "record", id: record.id, catalogId: record.slug, label: record.title };
    }
    if (targetType === "relationship") {
      const archive = new ArchiveSurfaceRepository(this.db);
      const actor = buildActorContext({
        accountId,
        discoveries: await archive.discoveries(accountId),
        archiveIdentity: await archive.archiveIdentity(accountId)
      });
      const canonical = await archive.listRelationships({ limit: 200 });
      const visible = await filterRelationships(canonical, actor, archive);
      const match = visible.find((relationship) => relationship.relationshipRef === catalogId);
      if (!match) throw interactionError("evidence_not_found");
      const source = canonical.find((relationship) => relationshipPublicRef(relationship.id) === catalogId);
      return {
        type: "relationship", id: source.id, catalogId,
        label: `${match.source.title || match.source.catalogId} ${match.relationship} ${match.target.title || match.target.catalogId}`
      };
    }
    if (targetType === "inventory_instance") {
      const row = await new InvestigationRepository(this.db, this.repositoryOptions()).heldInventoryInstance(accountId, catalogId);
      if (!row) throw interactionError("evidence_not_found");
      return { type: "inventory_instance", id: row.id, catalogId: row.id, label: row.name };
    }
    const row = await new InvestigationRepository(this.db, this.repositoryOptions()).heldInventoryDefinition(accountId, catalogId);
    if (!row) throw interactionError("evidence_not_found");
    return { type: "inventory_definition", id: row.id, catalogId: row.item_key, label: row.name };
  }

  async requireCondition(accountId, conditionJson) {
    if (!conditionJson) return;
    const snapshot = await new ProgressionRepository(this.db).snapshot(accountId, {});
    if (!evaluateCondition(parseJson(conditionJson, null), snapshot).matched) throw interactionError("not_found");
  }

  repositoryOptions() {
    return { fieldEncryptionKey: this.fieldEncryptionKey };
  }

  now() {
    return this.clock().toISOString();
  }
}

async function ensureInteraction(repo, values) {
  const sourceSubject = values.accountId;
  const existing = await repo.find(values.sourceType, sourceSubject, values.idempotencyKey);
  if (existing) return existing;
  const interaction = {
    id: newId("interaction"), accountId: values.accountId, interactionType: values.commandType,
    sourceType: values.sourceType, sourceSubject, resourceType: values.resourceType,
    resourceId: values.resourceId, resourceRevision: values.resourceRevision,
    idempotencyKey: values.idempotencyKey, inputDigest: canonicalDigest(values.input),
    requestId: values.requestId, provenance: values.provenance, receivedAt: values.now
  };
  await repo.insert(interaction);
  return interaction;
}

export function interactionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
