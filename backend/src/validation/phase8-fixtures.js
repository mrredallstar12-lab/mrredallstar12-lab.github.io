import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { ContentRepository } from "../repositories/content-repository.js";
import { InventoryRepository } from "../repositories/inventory-repository.js";
import { InvestigationRepository } from "../repositories/investigation-repository.js";
import { PlayerStateProjectionRepository } from "../repositories/player-state-projection-repository.js";
import { ProgressionDefinitionRepository } from "../repositories/progression-definition-repository.js";

export function buildPhase8FixtureDescriptor(suffix) {
  return {
    namespace: `staging-validation-phase8-${suffix}`,
    investigationKey: `phase8.validation.${suffix}`,
    caseSlug: `phase8-investigation-${suffix}`,
    evidenceSlugs: [`phase8-evidence-a-${suffix}`, `phase8-evidence-b-${suffix}`],
    answer: `recurrence ${suffix}`,
    stepKey: "recurrence-phrase",
    discoveryKey: `phase8.validation.resolved.${suffix}`,
    credentialKey: `phase8.validation.acknowledged.${suffix}`,
    itemKey: `phase8_validation_receipt_${suffix}`
  };
}

export async function createPhase8Fixtures(db, fixture, config) {
  const phase8 = fixture.phase8;
  const content = new ContentRepository(db);
  const surface = new ArchiveSurfaceRepository(db);
  const inventory = new InventoryRepository(db);
  const investigations = new InvestigationRepository(db, {
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const projections = new PlayerStateProjectionRepository(db, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const definitions = new ProgressionDefinitionRepository(db);

  phase8.caseRecordId = await content.createRecord({
    slug: phase8.caseSlug, recordType: "case", title: "Phase 8 Validation Investigation",
    summary: "Disposable canonical investigation fixture.", status: "published",
    visibility: "authenticated", body: "Two candidate records were retained for deliberate evidence organization."
  });
  await surface.setPolicy({
    resourceType: "record", resourceId: phase8.caseRecordId, existenceBehavior: "not_found",
    catalogRule: { access: "authenticated" }, fieldRules: { body: { access: "authenticated" } }
  });
  phase8.evidenceRecordIds = [];
  for (let index = 0; index < phase8.evidenceSlugs.length; index += 1) {
    const id = await content.createRecord({
      slug: phase8.evidenceSlugs[index], recordType: "record",
      title: `Phase 8 Evidence Candidate ${String.fromCharCode(65 + index)}`,
      summary: "Disposable player-organized evidence candidate.", status: "published",
      visibility: "authenticated", body: `Candidate ${String.fromCharCode(65 + index)} retained.`
    });
    phase8.evidenceRecordIds.push(id);
    await surface.setPolicy({
      resourceType: "record", resourceId: id, existenceBehavior: "not_found",
      catalogRule: { access: "authenticated" }, fieldRules: { body: { access: "authenticated" } }
    });
  }
  phase8.relationshipId = await content.addRelationship({
    sourceType: "record", sourceId: phase8.caseRecordId, relationshipType: "supported_by",
    targetType: "record", targetId: phase8.evidenceRecordIds[0], canonical: true,
    provenance: { source: "phase8_validation_fixture" }
  });
  await surface.setPolicy({
    resourceType: "relationship", resourceId: phase8.relationshipId, existenceBehavior: "not_found",
    relationshipRule: { access: "discovered", discoveryKey: phase8.discoveryKey }
  });
  phase8.itemDefinitionId = await inventory.createDefinition({
    itemKey: phase8.itemKey, name: "Phase 8 Investigation Receipt",
    itemType: "archive_property", stackable: true,
    publicMetadata: { classification: "investigation", fixture: true },
    secretMetadata: { verifierMaterial: "must-not-project" }
  });
  await projections.upsertDefinition({
    subjectType: "discovery", subjectKey: phase8.discoveryKey,
    label: "Validation Investigation Resolution", summary: "The disposable investigation was resolved."
  });
  await projections.upsertDefinition({
    subjectType: "fictional_credential", subjectKey: phase8.credentialKey,
    label: "Validation Investigator Acknowledgement", summary: "A fictional Archive acknowledgement is active."
  });
  const created = await investigations.createDefinitionVersion({
    investigationKey: phase8.investigationKey, caseRecordId: phase8.caseRecordId,
    version: 1, status: "published", title: "Phase 8 Validation Investigation",
    summary: "Organize evidence and submit the exact recurrence phrase.",
    fixtureNamespace: phase8.namespace, createdBy: fixture.definitionCreatorAccountId || fixture.player.accountId,
    steps: [{
      stepKey: phase8.stepKey, label: "Recurrence phrase",
      prompt: "Enter the exact recurrence phrase.", expectedAnswer: phase8.answer,
      publicMetadata: { responseKind: "text", fixture: true },
      attemptPolicy: { maxAttemptsPerHour: 6 }
    }]
  });
  phase8.definitionId = created.definitionId;
  phase8.versionId = created.versionId;
  const draft = await investigations.createDefinitionVersion({
    investigationKey: phase8.investigationKey, caseRecordId: phase8.caseRecordId,
    version: 2, status: "draft", title: "Phase 8 Validation Investigation Draft",
    fixtureNamespace: phase8.namespace, createdBy: fixture.definitionCreatorAccountId || fixture.player.accountId,
    steps: [{ stepKey: phase8.stepKey, label: "Draft recurrence phrase", expectedAnswer: `draft ${phase8.answer}` }]
  });
  phase8.draftVersionId = draft.versionId;
  await definitions.createVersion({
    eventKey: `${phase8.namespace}.resolution`, triggerEventType: "archive.case.step.resolved",
    priority: 100, fixtureNamespace: phase8.namespace,
    createdBy: fixture.definitionCreatorAccountId || fixture.player.accountId,
    condition: {
      all: [
        { event_payload: { field: "caseCatalogId", equals: phase8.caseSlug } },
        { event_payload: { field: "stepKey", equals: phase8.stepKey } }
      ]
    },
    playerSafeLabel: "Investigation resolved",
    playerSafeSummary: "Canonical investigation consequences were committed.",
    effects: [
      { key: "discovery", type: "discovery.set", config: { key: phase8.discoveryKey, present: true } },
      { key: "inventory", type: "inventory.quantity", config: { itemKey: phase8.itemKey, delta: 1 } },
      { key: "credential", type: "fictional_clearance.set", config: { key: phase8.credentialKey, present: true } },
      { key: "relationship", type: "relationship.set", config: { relationshipId: phase8.relationshipId, present: true } }
    ]
  });
}

export function deletePhase8FixtureData(db, phase8, accountIds = []) {
  if (!phase8) return;
  const raw = db.database;
  const ids = accountIds.filter(Boolean);
  const records = [phase8.caseRecordId, ...(phase8.evidenceRecordIds || [])].filter(Boolean);
  db.transaction(() => {
    for (const accountId of ids) {
      raw.prepare("DELETE FROM case_investigation_resolutions WHERE account_investigation_id IN (SELECT id FROM account_case_investigations WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM case_investigation_attempts WHERE account_investigation_id IN (SELECT id FROM account_case_investigations WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM case_evidence_pins WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM account_case_investigations WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM canonical_interactions WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM progression_history WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM progression_outbox WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_effect_applications WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_rule_evaluations WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_events WHERE account_id = ?").run(accountId);
    }
    raw.prepare("DELETE FROM authored_event_version_effects WHERE definition_version_id IN (SELECT id FROM authored_event_versions WHERE fixture_namespace = ?)").run(phase8.namespace);
    raw.prepare("DELETE FROM authored_event_versions WHERE fixture_namespace = ?").run(phase8.namespace);
    raw.prepare("DELETE FROM authored_events WHERE event_key LIKE ?").run(`${phase8.namespace}.%`);
    raw.prepare("DELETE FROM case_investigation_steps WHERE investigation_version_id IN (SELECT id FROM case_investigation_versions WHERE fixture_namespace = ?)").run(phase8.namespace);
    raw.prepare("DELETE FROM case_investigation_versions WHERE fixture_namespace = ?").run(phase8.namespace);
    raw.prepare("DELETE FROM case_investigation_definitions WHERE investigation_key = ?").run(phase8.investigationKey);
    if (phase8.relationshipId) {
      raw.prepare("DELETE FROM account_relationship_discoveries WHERE relationship_id = ?").run(phase8.relationshipId);
      raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'relationship' AND resource_id = ?").run(phase8.relationshipId);
      raw.prepare("DELETE FROM entity_relationships WHERE id = ?").run(phase8.relationshipId);
    }
    raw.prepare("DELETE FROM player_state_projection_definitions WHERE subject_key IN (?, ?)").run(phase8.discoveryKey, phase8.credentialKey);
    for (const recordId of records) {
      raw.prepare("DELETE FROM record_protected_fields WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'record' AND resource_id = ?").run(recordId);
      raw.prepare("DELETE FROM record_access_rules WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM record_revisions WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM records WHERE id = ?").run(recordId);
    }
    const item = raw.prepare("SELECT id FROM inventory_item_definitions WHERE item_key = ?").get(phase8.itemKey);
    if (item) {
      raw.prepare("DELETE FROM inventory_item_history WHERE item_instance_id IN (SELECT id FROM inventory_item_instances WHERE item_definition_id = ?)").run(item.id);
      raw.prepare("DELETE FROM inventory_ledger WHERE item_definition_id = ?").run(item.id);
      raw.prepare("DELETE FROM inventory_balances WHERE item_definition_id = ?").run(item.id);
      raw.prepare("DELETE FROM inventory_item_instances WHERE item_definition_id = ?").run(item.id);
      raw.prepare("DELETE FROM inventory_item_definitions WHERE id = ?").run(item.id);
    }
  });
}
