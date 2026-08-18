export class OperationalModeRepository {
  constructor(db) {
    this.db = db;
  }

  async enabled(modeKey) {
    const row = await this.db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = ?").bind(modeKey).first();
    return Number(row?.enabled || 0) === 1;
  }

  async set(modeKey, enabled, { actorId = null, reason = "" } = {}) {
    if (!["registrations_disabled", "auth_initiation_disabled", "player_mutations_disabled", "authored_events_disabled"].includes(modeKey)) {
      throw new Error("unknown_operational_mode");
    }
    await this.db.prepare(`
      INSERT INTO operational_modes (mode_key, enabled, reason, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(mode_key) DO UPDATE SET
        enabled = excluded.enabled,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).bind(modeKey, enabled ? 1 : 0, reason, actorId).run();
  }

  async all() {
    const rows = await this.db.prepare("SELECT mode_key, enabled, reason, updated_at FROM operational_modes ORDER BY mode_key").all();
    return (rows.results || []).map((row) => ({
      modeKey: row.mode_key,
      enabled: Number(row.enabled || 0) === 1,
      reason: row.reason || "",
      updatedAt: row.updated_at
    }));
  }
}
