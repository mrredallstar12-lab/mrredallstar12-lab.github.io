import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SQLiteD1Adapter } from "./sqlite-adapter.js";

export function listMigrationFiles(migrationsDir) {
  const dir = resolve(migrationsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort()
    .map((name) => join(dir, name));
}

export async function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function appliedMigrations(db) {
  await ensureMigrationTable(db);
  const rows = await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  return new Set((rows.results || []).map((row) => row.version));
}

export async function applyMigrations(db, migrationsDir) {
  await ensureMigrationTable(db);
  const applied = await appliedMigrations(db);
  const appliedNow = [];
  for (const file of listMigrationFiles(migrationsDir)) {
    const name = basename(file);
    const version = name.split("_")[0];
    if (applied.has(version)) continue;
    const sql = readFileSync(file, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.database.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(version, name);
    });
    appliedNow.push({ version, name });
  }
  return appliedNow;
}

export async function migrateSQLiteFile(sqlitePath, migrationsDir) {
  const db = new SQLiteD1Adapter(sqlitePath);
  try {
    return await applyMigrations(db, migrationsDir);
  } finally {
    db.close();
  }
}

