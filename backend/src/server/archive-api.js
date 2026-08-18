import { randomUUID } from "node:crypto";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { buildActorContext, filterRecord, filterRelationships, unauthorizedResponseShape } from "../archive/visibility-service.js";
import { jsonResponse, parseCookies } from "../security/http.js";

async function actorFromRequest(request, env, config) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.ofa_session;
  if (!token) return { accountId: null };
  const auth = new AuthRepository(env.DB, { sessionPepper: config.sessionPepper });
  const session = await auth.findActiveSessionByToken(token);
  return { accountId: session?.account_id || null };
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
  const actorBase = await actorFromRequest(request, env, config);
  const actor = buildActorContext({
    accountId: actorBase.accountId,
    discoveries: await repo.discoveries(actorBase.accountId),
    archiveIdentity: await repo.archiveIdentity(actorBase.accountId)
  });

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
