import { newId } from "../foundation/ids.js";
import { ProgressionDefinitionRepository } from "../repositories/progression-definition-repository.js";
import { ProgressionRepository } from "../repositories/progression-repository.js";
import { canonicalDigest } from "./canonical.js";
import { validateAndCanonicalizeEvent } from "./event-registry.js";
import { evaluateCondition } from "./rule-evaluator.js";

const DRY_RUN_ROLLBACK = Symbol("dry_run_rollback");

export class ProgressionEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.environment = options.environment || "production";
    this.clock = options.clock || (() => new Date());
    this.limits = {
      maxDepth: boundedLimit(options.maxDepth, 4),
      maxEvents: boundedLimit(options.maxEvents, 32),
      maxEffects: boundedLimit(options.maxEffects, 128),
      maxDefinitions: boundedLimit(options.maxDefinitions, 32)
    };
  }

  async ingest(input) {
    return await this.execute(input, { dryRun: false, ignoreKillSwitch: false });
  }

  async simulate(input) {
    return await this.execute(input, { dryRun: true, ignoreKillSwitch: true });
  }

  async execute(input, options) {
    validateIdempotencyKey(input.idempotencyKey);
    const registered = validateAndCanonicalizeEvent({
      eventType: input.eventType,
      sourceType: input.sourceType,
      environment: this.environment,
      payload: input.payload || {}
    });
    if (!registered.ok) throw progressionError(registered.code, registered.detail);

    const payload = registered.payload;
    const payloadDigest = canonicalDigest(payload);
    const outsideRepo = new ProgressionRepository(this.db);
    const existing = await outsideRepo.findByIdempotency(input.sourceType, input.sourceSubject, input.idempotencyKey);
    if (existing) return duplicateResult(existing, payloadDigest);
    if (!options.ignoreKillSwitch && await eventEngineDisabled(this.db)) throw progressionError("authored_events_disabled");

    let dryRunResult;
    try {
      const result = await this.db.withTransaction(async (tx) => {
        const progression = new ProgressionRepository(tx);
        const definitions = new ProgressionDefinitionRepository(tx);
        const duplicate = await progression.findByIdempotency(input.sourceType, input.sourceSubject, input.idempotencyKey);
        if (duplicate) return duplicateResult(duplicate, payloadDigest);

        const rootId = newId("pevent");
        const receivedAt = this.clock().toISOString();
        const root = {
          id: rootId,
          eventType: input.eventType,
          schemaVersion: 1,
          accountId: input.accountId || null,
          sourceType: input.sourceType,
          sourceSubject: input.sourceSubject,
          idempotencyKey: input.idempotencyKey,
          payload,
          payloadDigest,
          provenance: input.provenance || {},
          requestId: input.requestId || null,
          receivedAt,
          occurredAt: input.occurredAt || null,
          rootEventId: null,
          parentEventId: null,
          chainDepth: 0,
          lineage: [input.eventType]
        };
        const queue = [root];
        const eventResults = [];
        let effectCount = 0;

        while (queue.length) {
          if (eventResults.length + queue.length > this.limits.maxEvents) throw progressionError("chain_event_limit_exceeded");
          const event = queue.shift();
          await progression.insertEvent(event);
          const versions = await definitions.publishedForTrigger(event.eventType);
          if (versions.length > this.limits.maxDefinitions) throw progressionError("definition_limit_exceeded");
          const snapshot = await progression.snapshot(event.accountId, event.payload);
          const evaluations = [];

          for (const definition of versions) {
            const explanation = evaluateCondition(definition.condition, snapshot);
            const evaluationId = newId("peval");
            await progression.recordEvaluation({
              id: evaluationId,
              eventId: event.id,
              definitionVersionId: definition.id,
              matched: explanation.matched,
              explanation,
              snapshotDigest: snapshot.digest,
              evaluatedAt: receivedAt
            });
            evaluations.push({ definition, evaluationId, explanation });
          }

          const effects = [];
          for (const evaluation of evaluations.filter((item) => item.explanation.matched)) {
            for (const effect of evaluation.definition.effects) {
              effectCount += 1;
              if (effectCount > this.limits.maxEffects) throw progressionError("chain_effect_limit_exceeded");
              const effectApplicationId = newId("peffect");
              const applied = await progression.applyEffect({
                event,
                definition: evaluation.definition,
                evaluationId: evaluation.evaluationId,
                effect,
                effectApplicationId,
                idempotencyKey: `${event.id}:${evaluation.definition.id}:${effect.effect_key}`,
                appliedAt: receivedAt
              });
              effects.push({ effectKey: effect.effect_key, effectType: effect.effect_type, ...applied });
              if (applied.emitted) {
                const nextDepth = event.chainDepth + 1;
                if (nextDepth > this.limits.maxDepth) throw progressionError("chain_depth_limit_exceeded");
                if (event.lineage.includes(applied.emitted.eventType)) throw progressionError("chain_cycle_detected");
                const validatedChild = validateAndCanonicalizeEvent({
                  eventType: applied.emitted.eventType,
                  sourceType: "chained",
                  environment: this.environment,
                  payload: applied.emitted.payload
                });
                if (!validatedChild.ok) throw progressionError(validatedChild.code, validatedChild.detail);
                const childId = newId("pevent");
                queue.push({
                  id: childId,
                  eventType: applied.emitted.eventType,
                  schemaVersion: 1,
                  accountId: event.accountId,
                  sourceType: "chained",
                  sourceSubject: rootId,
                  idempotencyKey: `${rootId}:${effectApplicationId}`,
                  payload: validatedChild.payload,
                  payloadDigest: canonicalDigest(validatedChild.payload),
                  provenance: { parentEventId: event.id, effectApplicationId },
                  requestId: event.requestId,
                  receivedAt,
                  occurredAt: null,
                  rootEventId: rootId,
                  parentEventId: event.id,
                  chainDepth: nextDepth,
                  lineage: [...event.lineage, applied.emitted.eventType]
                });
              }
            }
          }

          const matchedCount = evaluations.filter((item) => item.explanation.matched).length;
          const status = matchedCount ? "completed" : "no_match";
          await progression.completeEvent(event.id, status, matchedCount ? "effects_applied" : "no_matching_definition", receivedAt);
          eventResults.push({ eventId: event.id, eventType: event.eventType, status, matchedDefinitions: matchedCount, effects });
        }

        const executionResult = { ok: true, duplicate: false, dryRun: options.dryRun, rootEventId: rootId, eventCount: eventResults.length, effectCount, events: eventResults };
        if (options.dryRun) {
          dryRunResult = executionResult;
          throw DRY_RUN_ROLLBACK;
        }
        return executionResult;
      });
      return result;
    } catch (error) {
      if (error === DRY_RUN_ROLLBACK) return { ...dryRunResult, committed: false };
      if (!error.code && typeof error.message === "string") error.code = error.message;
      throw error;
    }
  }
}

async function eventEngineDisabled(db) {
  const row = await db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = 'authored_events_disabled'").first();
  return !!row?.enabled;
}

function duplicateResult(existing, payloadDigest) {
  if (existing.payload_digest !== payloadDigest) throw progressionError("idempotency_conflict");
  return {
    ok: true,
    duplicate: true,
    dryRun: false,
    rootEventId: existing.root_event_id || existing.id,
    status: existing.status,
    completionCode: existing.completion_code
  };
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw progressionError("idempotency_key_invalid");
  }
}

export function progressionError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function boundedLimit(value, hardMaximum) {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value < 1) throw progressionError("execution_limit_invalid");
  return Math.min(value, hardMaximum);
}
