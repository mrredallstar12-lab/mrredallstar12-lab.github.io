import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerConfig } from "../server/config.js";
import { backupSQLiteDatabase, restoreSQLiteBackup, verifySQLiteRestore } from "./sqlite-backup.js";

const config = loadServerConfig();
if (!config.sqlitePath) {
  console.error("OFA_SQLITE_PATH is required for backup validation.");
  process.exit(1);
}

const backupDir = process.env.OFA_BACKUP_DIR || join(tmpdir(), "ofa-backups");
const restoreDir = mkdtempSync(join(tmpdir(), "ofa-restore-"));
const backupPath = backupSQLiteDatabase(config.sqlitePath, backupDir);
const restorePath = restoreSQLiteBackup(backupPath, join(restoreDir, "restored.sqlite"));
const verified = await verifySQLiteRestore(restorePath);
console.log(JSON.stringify({ ok: verified.ok, backupPath, restorePath, verified }, null, 2));
process.exit(verified.ok ? 0 : 1);

