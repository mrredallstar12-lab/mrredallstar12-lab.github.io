import { randomUUID } from "node:crypto";
import { AccountRepository } from "../repositories/account-repository.js";
import { ArchiveStateRepository } from "../repositories/archive-state-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { ContentRepository } from "../repositories/content-repository.js";
import { InventoryRepository } from "../repositories/inventory-repository.js";
import { PlayerStateRepository } from "../repositories/player-state-repository.js";
import { PlayerStateProjectionRepository } from "../repositories/player-state-projection-repository.js";
import { ProgressionDefinitionRepository } from "../repositories/progression-definition-repository.js";

export async function createValidationFixtures(db, config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const accounts = new AccountRepository(db, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const auth = new AuthRepository(db, { sessionPepper: config.sessionPepper });

  const adminUsername = `ValAdmin${suffix}`;
  const playerUsername = `ValPlayer${suffix}`;
  const admin = await accounts.createAccountWithEmail({ username: adminUsername, email: `${suffix}-admin@example.invalid` });
  const player = await accounts.createAccountWithEmail({ username: playerUsername, email: `${suffix}-player@example.invalid` });
  if (!admin.ok || !player.ok) throw new Error("validation_fixture_creation_failed");

  await auth.grantRole(admin.accountId, "system_admin", "global", "staging-validation-harness");
  await auth.grantRole(admin.accountId, "owner", "global", "staging-validation-harness");
  const adminSession = await auth.createSession({ accountId: admin.accountId, metadata: { source: "staging-validation-harness" } });
  const playerSession = await auth.createSession({ accountId: player.accountId, metadata: { source: "staging-validation-harness" } });

  const fixture = {
    suffix,
    admin: { ...admin, session: adminSession },
    player: { ...player, session: playerSession },
    itemKey: `staging_validation_item_${suffix}`,
    phase6: {
      namespace: `staging-validation-${suffix}`,
      itemKey: `phase6_validation_ticket_${suffix}`,
      relationshipId: `rel_phase6_validation_${suffix}`,
      stateScopeKey: `phase6-validation-${suffix}`,
      prerequisiteDiscovery: `phase6.validation.prerequisite.${suffix}`,
      resultDiscovery: `phase6.validation.result.${suffix}`,
      grantedClearance: `phase6.validation.granted.${suffix}`,
      followupClearance: `phase6.validation.followup.${suffix}`,
      siblingClearance: `phase6.validation.sibling.${suffix}`
    },
    phase7: buildPhase7FixtureDescriptor(suffix)
  };
  try {
    await createPhase6Fixtures(db, fixture);
    await createPhase7Fixtures(db, fixture, config);
    return fixture;
  } catch (error) {
    await cleanupValidationFixtures(db, fixture, "staging-validation-setup-failed-");
    throw error;
  }
}

export function buildPhase7FixtureDescriptor(suffix) {
  return {
    namespace: `staging-validation-phase7-${suffix}`,
    reviewSlug: `phase7-review-${suffix}`,
    hiddenSlug: `phase7-hidden-${suffix}`,
    relatedSlug: `phase7-related-${suffix}`,
    discoveryKey: `phase7.validation.finding.${suffix}`,
    credentialKey: `phase7.validation.reviewed.${suffix}`,
    unknownDiscoveryKey: `phase7.validation.unknown-discovery.${suffix}`,
    unknownCredentialKey: `phase7.validation.unknown-credential.${suffix}`,
    itemKey: `phase7_validation_receipt_${suffix}`
  };
}

export async function createPhase7Fixtures(db, fixture, config) {
  const { phase7, player } = fixture;
  const content = new ContentRepository(db);
  const surface = new ArchiveSurfaceRepository(db);
  const inventory = new InventoryRepository(db);
  const discoveries = new PlayerStateRepository(db);
  const projections = new PlayerStateProjectionRepository(db, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const definitions = new ProgressionDefinitionRepository(db);

  phase7.reviewRecordId = await content.createRecord({
    slug: phase7.reviewSlug,
    recordType: "case",
    title: "Phase 7 Validation Review",
    summary: "Disposable canonical player integration fixture.",
    status: "published",
    visibility: "authenticated",
    body: "This validation envelope is available to authenticated Archive personnel."
  });
  await surface.setProtectedField({
    recordId: phase7.reviewRecordId,
    fieldKey: "reviewFinding",
    value: "THE VALIDATION ENVELOPE REMEMBERED THE REVIEW."
  });
  await surface.setPolicy({
    resourceType: "record",
    resourceId: phase7.reviewRecordId,
    existenceBehavior: "known_restricted",
    catalogRule: { access: "authenticated" },
    fieldRules: {
      body: { access: "authenticated" },
      reviewFinding: { access: "discovered", discoveryKey: phase7.discoveryKey, redactedValue: "[REVIEW REQUIRED]" }
    }
  });

  phase7.relatedRecordId = await content.createRecord({
    slug: phase7.relatedSlug,
    recordType: "record",
    title: "Phase 7 Validation Corollary",
    summary: "Disposable relationship target.",
    status: "published",
    visibility: "authenticated",
    body: "Corollary retained for validation."
  });
  phase7.hiddenRecordId = await content.createRecord({
    slug: phase7.hiddenSlug,
    recordType: "record",
    title: "Phase 7 Withheld Validation Record",
    summary: "Existence must remain withheld.",
    status: "published",
    visibility: "restricted",
    body: "This material must not leak before discovery."
  });
  await surface.setPolicy({
    resourceType: "record",
    resourceId: phase7.hiddenRecordId,
    existenceBehavior: "not_found",
    catalogRule: { access: "discovered", discoveryKey: `phase7.validation.hidden.${fixture.suffix}` },
    fieldRules: { body: { access: "discovered", discoveryKey: `phase7.validation.hidden.${fixture.suffix}` } }
  });

  phase7.relationshipId = await content.addRelationship({
    sourceType: "record",
    sourceId: phase7.reviewRecordId,
    relationshipType: "documents",
    targetType: "record",
    targetId: phase7.relatedRecordId,
    canonical: true,
    provenance: { source: "staging_validation_harness" }
  });
  await surface.setPolicy({
    resourceType: "relationship",
    resourceId: phase7.relationshipId,
    existenceBehavior: "not_found",
    relationshipRule: { access: "discovered", discoveryKey: phase7.discoveryKey }
  });

  phase7.itemDefinitionId = await inventory.createDefinition({
    itemKey: phase7.itemKey,
    name: "Phase 7 Review Receipt",
    itemType: "archive_property",
    stackable: true,
    publicMetadata: { classification: "routine", fixture: true },
    secretMetadata: { neverExpose: `phase7-secret-${fixture.suffix}` }
  });
  await projections.upsertDefinition({
    subjectType: "discovery",
    subjectKey: phase7.discoveryKey,
    label: "Validation Finding",
    summary: "The reviewed envelope disclosed an additional finding."
  });
  await projections.upsertDefinition({
    subjectType: "fictional_credential",
    subjectKey: phase7.credentialKey,
    label: "Validation Review Acknowledgement",
    summary: "Archive review acknowledgement is active."
  });
  await discoveries.addDiscovery({
    accountId: player.accountId,
    discoveryType: "internal",
    discoveryKey: phase7.unknownDiscoveryKey,
    provenance: { source: "staging_validation_harness" }
  });
  const identity = await db.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").bind(player.accountId).first();
  const clearanceState = JSON.parse(identity?.clearance_state_json || "{}");
  clearanceState.clearances = [...new Set([...(clearanceState.clearances || []), phase7.unknownCredentialKey])];
  await db.prepare("UPDATE archive_identities SET clearance_state_json = ? WHERE account_id = ?")
    .bind(JSON.stringify(clearanceState), player.accountId).run();

  await definitions.createVersion({
    eventKey: `${phase7.namespace}.record-review`,
    triggerEventType: "archive.record.reviewed",
    priority: 100,
    condition: { event_payload: { field: "catalogId", equals: phase7.reviewSlug } },
    fixtureNamespace: phase7.namespace,
    createdBy: fixture.definitionCreatorAccountId || fixture.admin.accountId,
    playerSafeLabel: "Record review processed",
    playerSafeSummary: "Canonical Archive state changed after a validated review.",
    effects: [
      { key: "finding", type: "discovery.set", config: { key: phase7.discoveryKey, present: true } },
      { key: "receipt", type: "inventory.quantity", config: { itemKey: phase7.itemKey, delta: 1 } },
      { key: "credential", type: "fictional_clearance.set", config: { key: phase7.credentialKey, present: true } },
      { key: "relationship", type: "relationship.set", config: { relationshipId: phase7.relationshipId, present: true } }
    ]
  });
}

async function createPhase6Fixtures(db, fixture) {
  const { phase6, player } = fixture;
  const inventory = new InventoryRepository(db);
  const discoveries = new PlayerStateRepository(db);
  const archiveState = new ArchiveStateRepository(db);
  const definitions = new ProgressionDefinitionRepository(db);

  phase6.itemDefinitionId = await inventory.createDefinition({
    itemKey: phase6.itemKey,
    name: "Phase 6 Validation Ticket",
    itemType: "staging_validation",
    stackable: true
  });
  await inventory.grantQuantity({
    accountId: player.accountId,
    itemDefinitionId: phase6.itemDefinitionId,
    quantity: 1,
    provenance: { source: "staging_validation_harness" },
    idempotencyKey: `${phase6.namespace}:prerequisite-item`
  });
  await discoveries.addDiscovery({
    accountId: player.accountId,
    discoveryType: "phase6_validation",
    discoveryKey: phase6.prerequisiteDiscovery,
    provenance: { source: "staging_validation_harness" }
  });
  await db.prepare("UPDATE archive_identities SET clearance_state_json = ? WHERE account_id = ?")
    .bind(JSON.stringify({ clearances: ["phase6.validation.prerequisite"] }), player.accountId).run();
  await db.prepare(`
    INSERT INTO entity_relationships (
      id, source_type, source_id, relationship_type, target_type, target_id, canonical, provenance_json
    ) VALUES (?, 'validation_fixture', ?, 'validates', 'validation_fixture', ?, 1, ?)
  `).bind(phase6.relationshipId, `${fixture.suffix}:source`, `${fixture.suffix}:target`, JSON.stringify({ source: "staging_validation_harness" })).run();
  await db.prepare(`
    INSERT INTO account_relationship_discoveries (account_id, relationship_id, status, provenance_json)
    VALUES (?, ?, 'active', ?)
  `).bind(player.accountId, phase6.relationshipId, JSON.stringify({ source: "staging_validation_harness" })).run();
  await archiveState.transition({
    scopeType: "global",
    scopeKey: phase6.stateScopeKey,
    transitionType: "seed",
    nextState: { condition: "stable" },
    causeType: "staging_validation_harness"
  });

  const condition = {
    all: [
      { discovery: { key: phase6.prerequisiteDiscovery, present: true } },
      { inventory_quantity: { itemKey: phase6.itemKey, op: "gte", value: 1 } },
      { fictional_clearance: { key: "phase6.validation.prerequisite", present: true } },
      { prior_event_count: { eventType: "phase6.staging.observation", op: "gte", value: 1 } },
      { relationship_discovered: { relationshipId: phase6.relationshipId, present: true } },
      { archive_state: { scopeType: "global", scopeKey: phase6.stateScopeKey, path: "condition", equals: "stable" } },
      { event_payload: { field: "signalKey", equals: "validation" } },
      { not: { discovery: { key: phase6.resultDiscovery, present: true } } },
      { any: [
        { event_payload: { field: "sequence", equals: 2 } },
        { fictional_clearance: { key: "phase6.validation.alternative", present: true } }
      ] }
    ]
  };
  await definitions.createVersion({
    eventKey: `${phase6.namespace}.compound`,
    triggerEventType: "phase6.staging.observation",
    priority: 100,
    condition,
    fixtureNamespace: phase6.namespace,
    createdBy: fixture.admin.accountId,
    effects: [
      { key: "grant-discovery", type: "discovery.set", config: { key: phase6.resultDiscovery, present: true } },
      { key: "grant-inventory", type: "inventory.quantity", config: { itemKey: phase6.itemKey, delta: 2 } },
      { key: "grant-clearance", type: "fictional_clearance.set", config: { key: phase6.grantedClearance, present: true } },
      { key: "revoke-relationship", type: "relationship.set", config: { relationshipId: phase6.relationshipId, present: false } },
      { key: "transition-state", type: "archive_state.transition", config: { scopeType: "global", scopeKey: phase6.stateScopeKey, transitionType: "awaken", set: { condition: "awakened" } } },
      { key: "emit-followup", type: "event.emit", config: { eventType: "phase6.staging.followup", payload: { marker: "validation-complete" } } }
    ]
  });
  await definitions.createVersion({
    eventKey: `${phase6.namespace}.sibling-snapshot`,
    triggerEventType: "phase6.staging.observation",
    priority: 50,
    condition: { discovery: { key: phase6.resultDiscovery, present: true } },
    fixtureNamespace: phase6.namespace,
    createdBy: fixture.admin.accountId,
    effects: [{ key: "must-not-run", type: "fictional_clearance.set", config: { key: phase6.siblingClearance, present: true } }]
  });
  await definitions.createVersion({
    eventKey: `${phase6.namespace}.followup`,
    triggerEventType: "phase6.staging.followup",
    condition: { discovery: { key: phase6.resultDiscovery, present: true } },
    fixtureNamespace: phase6.namespace,
    createdBy: fixture.admin.accountId,
    effects: [{ key: "followup-clearance", type: "fictional_clearance.set", config: { key: phase6.followupClearance, present: true } }]
  });
  await definitions.createVersion({
    eventKey: `${phase6.namespace}.rollback`,
    triggerEventType: "phase6.staging.rollback",
    condition: { not: { discovery: { key: `phase6.validation.rollback-never.${fixture.suffix}`, present: true } } },
    fixtureNamespace: phase6.namespace,
    createdBy: fixture.admin.accountId,
    effects: [
      { key: "temporary-discovery", type: "discovery.set", config: { key: `phase6.validation.must-rollback.${fixture.suffix}`, present: true } },
      { key: "invalid-consume", type: "inventory.quantity", config: { itemKey: phase6.itemKey, delta: -999 } }
    ]
  });
  for (let index = 1; index <= 5; index += 1) {
    await definitions.createVersion({
      eventKey: `${phase6.namespace}.chain.${index}`,
      triggerEventType: `phase6.staging.chain.${index}`,
      condition: { not: { discovery: { key: `phase6.validation.chain-stop.${fixture.suffix}`, present: true } } },
      fixtureNamespace: phase6.namespace,
      createdBy: fixture.admin.accountId,
      effects: [{ key: "next", type: "event.emit", config: { eventType: `phase6.staging.chain.${index + 1}`, payload: {} } }]
    });
  }
  await definitions.createVersion({
    eventKey: `${phase6.namespace}.concurrent`,
    triggerEventType: "archive.record.accessed",
    condition: { event_payload: { field: "catalogId", equals: "phase4-signal-001" } },
    fixtureNamespace: phase6.namespace,
    createdBy: fixture.admin.accountId,
    effects: [{ key: "increment", type: "inventory.quantity", config: { itemKey: phase6.itemKey, delta: 1 } }]
  });
}

export async function cleanupValidationFixtures(db, fixture, requestPrefix) {
  if (!fixture) return;
  const accountIds = [fixture.admin.accountId, fixture.player.accountId];
  const raw = db.database;

  db.transaction(() => {
    raw.prepare("DELETE FROM progression_history WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM progression_outbox WHERE event_id IN (SELECT id FROM progression_events WHERE account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM progression_effect_applications WHERE event_id IN (SELECT id FROM progression_events WHERE account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM progression_rule_evaluations WHERE event_id IN (SELECT id FROM progression_events WHERE account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM progression_events WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM authored_event_version_effects WHERE definition_version_id IN (SELECT id FROM authored_event_versions WHERE fixture_namespace = ?)").run(fixture.phase6.namespace);
    raw.prepare("DELETE FROM authored_event_versions WHERE fixture_namespace = ?").run(fixture.phase6.namespace);
    raw.prepare("DELETE FROM authored_events WHERE event_key LIKE ?").run(`${fixture.phase6.namespace}.%`);
    raw.prepare("DELETE FROM authored_event_version_effects WHERE definition_version_id IN (SELECT id FROM authored_event_versions WHERE fixture_namespace = ?)").run(fixture.phase7.namespace);
    raw.prepare("DELETE FROM authored_event_versions WHERE fixture_namespace = ?").run(fixture.phase7.namespace);
    raw.prepare("DELETE FROM authored_events WHERE event_key LIKE ?").run(`${fixture.phase7.namespace}.%`);
    raw.prepare("DELETE FROM archive_state_history WHERE scope_id IN (SELECT id FROM archive_state_scopes WHERE scope_type = 'global' AND scope_key = ?)").run(fixture.phase6.stateScopeKey);
    raw.prepare("DELETE FROM archive_state_scopes WHERE scope_type = 'global' AND scope_key = ?").run(fixture.phase6.stateScopeKey);
    raw.prepare("DELETE FROM account_relationship_discoveries WHERE account_id IN (?, ?) OR relationship_id = ?").run(...accountIds, fixture.phase6.relationshipId);
    raw.prepare("DELETE FROM entity_relationships WHERE id = ?").run(fixture.phase6.relationshipId);
    raw.prepare("DELETE FROM account_relationship_discoveries WHERE relationship_id = ?").run(fixture.phase7.relationshipId);
    raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'relationship' AND resource_id = ?").run(fixture.phase7.relationshipId);
    raw.prepare("DELETE FROM entity_relationships WHERE id = ?").run(fixture.phase7.relationshipId);
    raw.prepare("DELETE FROM player_state_projection_definitions WHERE subject_key IN (?, ?)").run(fixture.phase7.discoveryKey, fixture.phase7.credentialKey);
    raw.prepare("DELETE FROM record_protected_fields WHERE record_id IN (?, ?, ?)").run(fixture.phase7.reviewRecordId, fixture.phase7.relatedRecordId, fixture.phase7.hiddenRecordId);
    raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'record' AND resource_id IN (?, ?, ?)").run(fixture.phase7.reviewRecordId, fixture.phase7.relatedRecordId, fixture.phase7.hiddenRecordId);
    raw.prepare("DELETE FROM record_revisions WHERE record_id IN (?, ?, ?)").run(fixture.phase7.reviewRecordId, fixture.phase7.relatedRecordId, fixture.phase7.hiddenRecordId);
    raw.prepare("DELETE FROM records WHERE id IN (?, ?, ?)").run(fixture.phase7.reviewRecordId, fixture.phase7.relatedRecordId, fixture.phase7.hiddenRecordId);
    raw.prepare("DELETE FROM audit_events WHERE request_id LIKE ? OR actor_id IN (?, ?) OR resource_id IN (?, ?)")
      .run(`${requestPrefix}%`, ...accountIds, ...accountIds);
    raw.prepare("DELETE FROM admin_elevations WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM session_csrf_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM sessions WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM auth_email_challenges WHERE account_id IN (?, ?)").run(...accountIds);
    for (const accountId of accountIds) {
      raw.prepare("DELETE FROM auth_rate_limits WHERE bucket_key LIKE ?").run(`%${accountId}%`);
    }
    raw.prepare("DELETE FROM inventory_relationships WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_history WHERE item_instance_id IN (SELECT id FROM inventory_item_instances WHERE owner_account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM inventory_ledger WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_balances WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_instances WHERE owner_account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_definitions WHERE item_key = ?").run(fixture.itemKey);
    raw.prepare("DELETE FROM inventory_item_definitions WHERE item_key = ?").run(fixture.phase6.itemKey);
    raw.prepare("DELETE FROM inventory_item_definitions WHERE item_key = ?").run(fixture.phase7.itemKey);
    raw.prepare("DELETE FROM account_discoveries WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_relationships WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_annotations WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_private_state WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_roles WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM username_history WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM sensitive_identity_data WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM external_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM archive_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_profiles WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM accounts WHERE id IN (?, ?)").run(...accountIds);
  });
}
