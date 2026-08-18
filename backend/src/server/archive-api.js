import { randomUUID } from "node:crypto";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { OperationalModeRepository } from "../repositories/operational-mode-repository.js";
import { PlayerStateProjectionRepository } from "../repositories/player-state-projection-repository.js";
import { RateLimitRepository } from "../repositories/rate-limit-repository.js";
import { ProgressionEngine } from "../progression/engine.js";
import { buildActorContext, filterRecord, filterRelationships, unauthorizedResponseShape } from "../archive/visibility-service.js";
import { jsonResponse, parseCookies } from "../security/http.js";

async function actorFromRequest(request, env, config) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.ofa_session;
  if (!token) return { accountId: null, session: null };
  const auth = new AuthRepository(env.DB, { sessionPepper: config.sessionPepper });
  const session = await auth.findActiveSessionByToken(token);
  return { accountId: session?.account_id || null, session: session || null };
}

function noStore(headers = {}) {
  return { "Cache-Control": "no-store", ...headers };
}

function recordTypeForCollection(collection) {
  return new Map([
    ["records", null],
    ["cases", "case"],
    ["incidents", "incident"],
    ["transmissions", "transmission"],
    ["artifacts", "artifact"],
    ["facilities", "facility"],
    ["media", "media"]
  ]).get(collection);
}

export async function handleArchiveApi(request, env, config, logger) {
  if (!env.DB) return jsonResponse({ ok: false, error: { code: "db_unavailable", message: "Database unavailable." } }, 503);
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const requestId = request.headers.get("X-Request-Id") || randomUUID();
  const repo = new ArchiveSurfaceRepository(env.DB);
  const audit = new AuditRepository(env.DB);
  const modes = new OperationalModeRepository(env.DB);
  const rateLimit = new RateLimitRepository(env.DB);
  const auth = new AuthRepository(env.DB, { sessionPepper: config.sessionPepper });
  const projection = new PlayerStateProjectionRepository(env.DB, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const actorBase = await actorFromRequest(request, env, config);
  const actor = buildActorContext({
    accountId: actorBase.accountId,
    discoveries: await repo.discoveries(actorBase.accountId),
    archiveIdentity: await repo.archiveIdentity(actorBase.accountId)
  });

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "archive" && parts[3] === "records" && parts[5] === "review" && parts.length === 6 && request.method === "POST") {
    if (await modes.enabled("player_surfaces_disabled")) return jsonResponse({ ok: false, error: { code: "player_surfaces_disabled", message: "Canonical player surfaces are temporarily unavailable." } }, 503, noStore());
    if (await modes.enabled("player_mutations_disabled")) return jsonResponse({ ok: false, error: { code: "player_mutations_disabled", message: "Player mutations are temporarily disabled." } }, 503, noStore());
    if (await modes.enabled("authored_events_disabled")) return jsonResponse({ ok: false, error: { code: "authored_events_disabled", message: "Authored event execution is disabled." } }, 503, noStore());
    if (!actorBase.accountId || !actorBase.session) return jsonResponse({ ok: false, error: { code: "auth_required", message: "Authentication required." } }, 401, noStore());
    if (!(await auth.verifyCsrf(actorBase.session.id, request.headers.get("X-OFA-CSRF") || ""))) {
      return jsonResponse({ ok: false, error: { code: "csrf_required", message: "CSRF validation failed." } }, 403, noStore());
    }
    const limited = await rateLimit.check(`account-op:archive.record.review:${actorBase.accountId}`, 30, 3600);
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429, noStore());

    const slug = decodeURIComponent(parts[4]);
    const record = await repo.findRecordBySlug(slug);
    if (!record) return jsonResponse({ ok: false, error: { code: "not_found", message: "Archive record not found." } }, 404, noStore());
    const authorized = await filterRecord(record, actor, repo, { detail: true });
    if (!authorized.visible || authorized.record?.access?.catalog !== "available") {
      const shape = authorized.shape || unauthorizedResponseShape(record.policy);
      await audit.record({ actorType: "account", actorId: actorBase.accountId, action: "archive.record.review", resourceType: "record", resourceId: record.id, result: "denied", requestId, context: { existenceBehavior: record.policy.existenceBehavior } });
      return jsonResponse(shape.body, shape.status, noStore());
    }

    const before = await projection.project(actorBase.accountId);
    try {
      const progression = await new ProgressionEngine(env.DB, { environment: config.envName }).ingest({
        eventType: "archive.record.reviewed",
        sourceType: "browser_session",
        sourceSubject: actorBase.accountId,
        accountId: actorBase.accountId,
        idempotencyKey: `review:${record.id}:${record.currentRevisionId || record.updatedAt}`,
        payload: { catalogId: record.slug, revision: record.currentRevisionId || record.updatedAt },
        provenance: { source: "authenticated_record_review", recordId: record.id },
        requestId
      });
      const after = await projection.project(actorBase.accountId);
      await audit.record({ actorType: "account", actorId: actorBase.accountId, action: "archive.record.review", resourceType: "record", resourceId: record.id, result: "allowed", requestId, context: { duplicate: progression.duplicate, stateChanged: before.revision !== after.revision } });
      return jsonResponse({
        ok: true,
        review: {
          catalogId: record.slug,
          duplicate: progression.duplicate,
          stateChanged: before.revision !== after.revision,
          stateRevision: after.revision
        }
      }, 200, noStore({ ETag: after.etag }));
    } catch (error) {
      const code = error.code || "progression_execution_failed";
      const status = code === "idempotency_conflict" ? 409 : code === "authored_events_disabled" ? 503 : 422;
      await audit.record({ actorType: "account", actorId: actorBase.accountId, action: "archive.record.review", resourceType: "record", resourceId: record.id, result: "denied", requestId, context: { code } });
      return jsonResponse({ ok: false, error: { code, message: "Record review could not be committed." } }, status, noStore());
    }
  }

  if (request.method !== "GET") return null;

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "archive" && parts[3] === "relationships" && parts.length === 4) {
    const relationships = await repo.listRelationships({ limit: url.searchParams.get("limit") || 100 });
    return jsonResponse({ ok: true, relationships: await filterRelationships(relationships, actor, repo) }, 200, noStore());
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "archive" && parts.length === 4) {
    const collection = parts[3];
    if (!["records", "cases", "incidents", "transmissions", "artifacts", "facilities", "media"].includes(collection)) return null;
    const records = await repo.listRecords({ recordType: recordTypeForCollection(collection), limit: url.searchParams.get("limit") || 50 });
    const filtered = [];
    for (const record of records) {
      const result = await filterRecord(record, actor, repo, { detail: false });
      if (result.visible) filtered.push(result.record);
    }
    return jsonResponse({ ok: true, records: filtered }, 200, noStore());
  }

  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "archive" && parts[3] === "records" && parts.length === 5) {
    const record = await repo.findRecordBySlug(parts[4]);
    if (!record) return jsonResponse({ ok: false, error: { code: "not_found", message: "Archive record not found." } }, 404, noStore());
    const result = await filterRecord(record, actor, repo, { detail: true });
    if (!result.visible) {
      const shape = result.shape || unauthorizedResponseShape(record.policy);
      if (shape.status === 403) {
        await audit.record({ actorType: actor.accountId ? "account" : "anonymous", actorId: actor.accountId, action: "archive.record.denied", resourceType: "record", resourceId: record.id, result: "denied", requestId, context: { slug: record.slug, existenceBehavior: record.policy.existenceBehavior } });
      }
      return jsonResponse(shape.body, shape.status, noStore());
    }
    return jsonResponse({ ok: true, record: result.record }, 200, noStore());
  }

  logger?.debug?.("archive_route_not_found", { path: url.pathname });
  return null;
}
