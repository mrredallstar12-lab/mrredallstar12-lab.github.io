import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../db/migrations.js";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { jsonString, newId } from "../foundation/ids.js";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { ContentRepository } from "../repositories/content-repository.js";
import { loadServerConfig } from "../server/config.js";

export async function seedPhase4Staging(db) {
  const existing = await db.prepare("SELECT seed_key FROM phase4_staging_seed_markers WHERE seed_key = 'phase4:archive-surfaces:v1'").first();
  if (existing) return { ok: true, seeded: false };

  const content = new ContentRepository(db);
  const surface = new ArchiveSurfaceRepository(db);

  const signalId = await content.createRecord({
    slug: "phase4-signal-001",
    recordType: "transmission",
    title: "Signal 001 / Catalog Envelope",
    summary: "A catalog-safe transmission envelope. Transcript withheld pending discovery.",
    status: "published",
    visibility: "public",
    body: "The signal is audible, but the transcript has not been released to this account."
  });
  await surface.setProtectedField({ recordId: signalId, fieldKey: "transcript", value: "WE WERE NEVER ONLY RECEIVING." });
  await surface.setProtectedField({ recordId: signalId, fieldKey: "operatorNote", value: "Do not describe the source as external. The Archive dislikes that." });
  await surface.setPolicy({
    resourceType: "record",
    resourceId: signalId,
    existenceBehavior: "catalog_stub",
    catalogRule: { access: "public" },
    fieldRules: {
      body: { access: "authenticated", redactedValue: "[AUTHENTICATED SESSION REQUIRED]" },
      transcript: { access: "discovered", discoveryKey: "phase4.signal001.transcript", redactedValue: "[TRANSCRIPT WITHHELD]" },
      operatorNote: { access: "withheld", redactedValue: "[REDACTED]" }
    }
  });

  const caseId = await content.createRecord({
    slug: "phase4-case-echo",
    recordType: "case",
    title: "Case Echo / Recurrence Test",
    summary: "A small staging case used to validate authenticated catalog access.",
    status: "published",
    visibility: "authenticated",
    body: "Authenticated case body. This is still staging validation material."
  });
  await surface.setProtectedField({ recordId: caseId, fieldKey: "personnelLinkage", value: ["subject-withheld", "witness-withheld"] });
  await surface.setPolicy({
    resourceType: "record",
    resourceId: caseId,
    existenceBehavior: "known_restricted",
    catalogRule: { access: "authenticated" },
    fieldRules: {
      body: { access: "authenticated" },
      personnelLinkage: { access: "discovered", discoveryKey: "phase4.caseecho.personnel", redactedValue: [] }
    }
  });

  const hiddenId = await content.createRecord({
    slug: "phase4-withheld-null",
    recordType: "record",
    title: "Withheld Null",
    summary: "This summary must not leak to unauthorized sessions.",
    status: "published",
    visibility: "restricted",
    body: "This body must not leak either."
  });
  await surface.setPolicy({
    resourceType: "record",
    resourceId: hiddenId,
    existenceBehavior: "not_found",
    catalogRule: { access: "discovered", discoveryKey: "phase4.withheld.null" },
    fieldRules: {
      body: { access: "discovered", discoveryKey: "phase4.withheld.null" }
    }
  });

  const relationshipId = newId("rel");
  await db.prepare(`
    INSERT INTO entity_relationships (id, source_type, source_id, relationship_type, target_type, target_id, canonical, confidence, provenance_json)
    VALUES (?, 'record', ?, 'recurs_with', 'record', ?, 1, 'staging', ?)
  `).bind(relationshipId, signalId, caseId, jsonString({ source: "phase4_staging_seed" })).run();
  await surface.setPolicy({
    resourceType: "relationship",
    resourceId: relationshipId,
    existenceBehavior: "not_found",
    relationshipRule: { access: "discovered", discoveryKey: "phase4.relationship.echo" }
  });

  await db.prepare("INSERT INTO phase4_staging_seed_markers (seed_key) VALUES ('phase4:archive-surfaces:v1')").run();
  return { ok: true, seeded: true };
}

const isDirect = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isDirect) {
  const config = loadServerConfig();
  const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const db = new SQLiteD1Adapter(config.sqlitePath);
  try {
    await applyMigrations(db, join(backendDir, "migrations-server"));
    const result = await seedPhase4Staging(db);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}
