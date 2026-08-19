import { filterRelationships, buildActorContext, filterRecord } from "../archive/visibility-service.js";
import { canonicalDigest } from "../progression/canonical.js";
import { parseJson, newId } from "../foundation/ids.js";
import { AccountRepository } from "./account-repository.js";
import { ArchiveSurfaceRepository } from "./archive-surface-repository.js";
import { MeInventoryRepository } from "./me-inventory-repository.js";
import { InvestigationRepository, safeStep } from "./investigation-repository.js";
import { ProgressionRepository } from "./progression-repository.js";
import { evaluateCondition } from "../progression/rule-evaluator.js";
import { relationshipPublicRef } from "../archive/visibility-service.js";

const RECEIPT_LIMIT = 12;

export class PlayerStateProjectionRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.accounts = new AccountRepository(db, options);
    this.archive = new ArchiveSurfaceRepository(db);
    this.inventory = new MeInventoryRepository(db);
    this.investigations = new InvestigationRepository(db, options);
  }

  async upsertDefinition({ subjectType, subjectKey, label, summary = null, sortOrder = 0, publicMetadata = {} }) {
    await this.db.prepare(`
      INSERT INTO player_state_projection_definitions (
        id, subject_type, subject_key, player_label, player_summary, sort_order, public_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_type, subject_key) DO UPDATE SET
        player_label = excluded.player_label,
        player_summary = excluded.player_summary,
        sort_order = excluded.sort_order,
        public_metadata_json = excluded.public_metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(newId("projection"), subjectType, subjectKey, label, summary, sortOrder, JSON.stringify(publicMetadata)).run();
  }

  async project(accountId) {
    const account = await this.accounts.publicAccountById(accountId);
    if (!account) return null;
    const identityRow = await this.db.prepare("SELECT designation, clearance_state_json FROM archive_identities WHERE account_id = ?").bind(accountId).first();
    const definitions = await this.definitions();
    const discoveryRows = await this.db.prepare("SELECT discovery_key, discovered_at FROM account_discoveries WHERE account_id = ?").bind(accountId).all();
    const discoveryTimes = new Map((discoveryRows.results || []).map((row) => [row.discovery_key, row.discovered_at]));
    const clearances = new Set(parseJson(identityRow?.clearance_state_json || "{}", {}).clearances || []);
    const inventory = await this.inventory.list(accountId);
    const actor = buildActorContext({
      accountId,
      discoveries: new Set(discoveryTimes.keys()),
      archiveIdentity: identityRow
    });
    const relationships = await filterRelationships(await this.archive.listRelationships({ limit: 200 }), actor, this.archive);

    const state = {
      account: {
        username: account.username_display,
        archiveIdentity: identityRow?.designation ? { designation: identityRow.designation } : null
      },
      discoveries: definitions
        .filter((definition) => definition.subject_type === "discovery" && discoveryTimes.has(definition.subject_key))
        .map((definition) => safeDefinition(definition, { discoveredAt: discoveryTimes.get(definition.subject_key) })),
      credentials: definitions
        .filter((definition) => definition.subject_type === "fictional_credential" && clearances.has(definition.subject_key))
        .map((definition) => safeDefinition(definition)),
      relationships,
      inventory: {
        balances: inventory.balances.map(({ itemKey, name, itemType, stackable, publicMetadata, quantity, updatedAt }) => ({
          itemKey, name, itemType, stackable, publicMetadata, quantity, updatedAt
        })),
        instances: inventory.instances.map(({ instanceRef, itemKey, name, itemType, publicMetadata, fictionalCustody, updatedAt }) => ({
          instanceRef, itemKey, name, itemType, publicMetadata, fictionalCustody, updatedAt
        }))
      },
      recentReceipts: await this.safeReceipts(accountId)
    };
    const investigationMode = await this.db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = 'investigations_disabled'").first();
    if (Number(investigationMode?.enabled || 0) === 0) {
      state.investigations = await this.safeInvestigations(accountId, actor);
    }
    const revision = canonicalDigest(state);
    return { ...state, revision, etag: `"ofa-state-${revision}"` };
  }

  async definitions() {
    const rows = await this.db.prepare(`
      SELECT subject_type, subject_key, player_label, player_summary, sort_order, public_metadata_json
      FROM player_state_projection_definitions
      ORDER BY subject_type, sort_order, subject_key
    `).all();
    return rows.results || [];
  }

  async safeReceipts(accountId) {
    const rows = await this.db.prepare(`
      SELECT v.player_safe_label, v.player_safe_summary, h.created_at
      FROM progression_history h
      JOIN authored_event_versions v ON v.id = h.definition_version_id
      WHERE h.account_id = ? AND h.player_visibility = 'player_safe' AND v.player_safe_label IS NOT NULL
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ?
    `).bind(accountId, RECEIPT_LIMIT).all();
    return (rows.results || []).map((row) => ({
      label: row.player_safe_label,
      summary: row.player_safe_summary || null,
      occurredAt: row.created_at
    }));
  }

  async safeInvestigations(accountId, actor) {
    const runs = await this.investigations.activeForAccount(accountId);
    const progression = new ProgressionRepository(this.db);
    const snapshot = await progression.snapshot(accountId, {});
    const projected = [];
    for (const run of runs) {
      const record = await this.archive.findRecordBySlug(run.slug);
      if (!record || !(await filterRecord(record, actor, this.archive, { detail: false })).visible) continue;
      const steps = await this.investigations.steps(run.version_id);
      const resolutionRows = await this.db.prepare(`
        SELECT step_version_id, resolved_at FROM case_investigation_resolutions
        WHERE account_investigation_id = ?
      `).bind(run.account_investigation_id).all();
      const resolutions = new Map((resolutionRows.results || []).map((row) => [row.step_version_id, row.resolved_at]));
      const visibleSteps = steps
        .filter((step) => conditionVisible(step.visibility_condition_json, snapshot))
        .map((step) => ({ ...safeStep(step, resolutions.has(step.id)), resolvedAt: resolutions.get(step.id) || null }));
      const pins = (await this.investigations.pins(run.account_investigation_id)).map((pin) => ({
        publicRef: pin.public_ref,
        targetType: pin.target_type,
        catalogId: pinCatalogId(pin),
        label: pinLabel(pin),
        pinnedAt: pin.pinned_at
      })).filter((pin) => pin.catalogId && pin.label);
      projected.push({
        case: { catalogId: run.slug, title: run.case_title },
        title: run.player_title,
        summary: run.player_summary || null,
        version: this.investigations.publicVersion(run),
        status: run.account_status,
        startedAt: run.started_at,
        resolvedAt: run.resolved_at || null,
        steps: visibleSteps,
        evidencePins: pins
      });
    }
    return projected;
  }
}

function safeDefinition(definition, extra = {}) {
  return {
    label: definition.player_label,
    summary: definition.player_summary || null,
    publicMetadata: parseJson(definition.public_metadata_json, {}),
    ...extra
  };
}

function conditionVisible(conditionJson, snapshot) {
  if (!conditionJson) return true;
  return evaluateCondition(parseJson(conditionJson, null), snapshot).matched;
}

function pinCatalogId(pin) {
  if (pin.target_type === "record") return pin.record_slug;
  if (pin.target_type === "relationship") return relationshipPublicRef(pin.target_id);
  if (pin.target_type === "inventory_instance") return pin.target_id;
  return pin.item_key;
}

function pinLabel(pin) {
  if (pin.target_type === "record") return pin.record_title;
  if (pin.target_type === "relationship") {
    return `${pin.relationship_source_title || "withheld"} ${pin.relationship_type} ${pin.relationship_target_title || "withheld"}`;
  }
  if (pin.target_type === "inventory_instance") return pin.instance_name;
  return pin.item_name;
}
