import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";

export async function sqliteIntegrityOk(sqlitePath) {
  const db = new SQLiteD1Adapter(sqlitePath);
  try {
    const row = await db.prepare("PRAGMA integrity_check").first();
    return row?.integrity_check === "ok";
  } finally {
    db.close();
  }
}

export async function copySQLiteStorageForMigration({ sourcePath, destinationPath, confirm }) {
  const source = resolve(sourcePath || "");
  const destination = resolve(destinationPath || "");
  if (confirm !== "COPY_ONLY") throw new Error("storage_migration_confirmation_required");
  if (!existsSync(source)) throw new Error("source_sqlite_not_found");
  if (source === destination) throw new Error("source_and_destination_must_differ");
  if (existsSync(destination)) throw new Error("destination_already_exists");
  if (existsSync(`${source}-wal`) || existsSync(`${source}-journal`)) throw new Error("refusing_possible_live_sqlite_migration");
  if (!(await sqliteIntegrityOk(source))) throw new Error("source_sqlite_integrity_failed");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  if (!(await sqliteIntegrityOk(destination))) throw new Error("destination_sqlite_integrity_failed");
  return { ok: true, source, destination };
}

