import { filterRelationships, buildActorContext } from "../archive/visibility-service.js";
import { canonicalDigest } from "../progression/canonical.js";
import { parseJson, newId } from "../foundation/ids.js";
import { AccountRepository } from "./account-repository.js";
import { ArchiveSurfaceRepository } from "./archive-surface-repository.js";
import { MeInventoryRepository } from "./me-inventory-repository.js";

const RECEIPT_LIMIT = 12;

export class PlayerStateProjectionRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.accounts = new AccountRepository(db, options);
    this.archive = new ArchiveSurfaceRepository(db);
    this.inventory = new MeInventoryRepository(db);
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
}

function safeDefinition(definition, extra = {}) {
  return {
    label: definition.player_label,
    summary: definition.player_summary || null,
    publicMetadata: parseJson(definition.public_metadata_json, {}),
    ...extra
  };
}
