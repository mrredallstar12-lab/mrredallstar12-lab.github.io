import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function backupSQLiteDatabase(sourcePath, backupDir) {
  if (!existsSync(sourcePath)) throw new Error(`SQLite source does not exist: ${sourcePath}`);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(resolve(backupDir), `${basename(sourcePath, ".sqlite")}-${timestamp()}.sqlite`);
  copyFileSync(sourcePath, backupPath);
  return backupPath;
}

export function restoreSQLiteBackup(backupPath, restorePath) {
  if (!existsSync(backupPath)) throw new Error(`SQLite backup does not exist: ${backupPath}`);
  mkdirSync(dirname(resolve(restorePath)), { recursive: true });
  copyFileSync(backupPath, restorePath);
  return restorePath;
}

export async function verifySQLiteRestore(sqlitePath, requiredTables = ["schema_migrations", "accounts", "sessions"]) {
  const db = new SQLiteD1Adapter(sqlitePath);
  try {
    for (const table of requiredTables) {
      const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first();
      if (!row) return { ok: false, missingTable: table };
    }
    const migrationRows = await db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").first();
    return { ok: Number(migrationRows?.count || 0) > 0, migrationCount: Number(migrationRows?.count || 0) };
  } finally {
    db.close();
  }
}

