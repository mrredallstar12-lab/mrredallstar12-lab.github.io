import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "../server/config.js";
import { migrateSQLiteFile } from "./migrations.js";

const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const config = loadServerConfig();
if (!config.sqlitePath) {
  console.error("OFA_SQLITE_PATH is required for server migrations.");
  process.exit(1);
}

const migrationsDir = join(backendDir, "migrations-server");
const applied = await migrateSQLiteFile(config.sqlitePath, migrationsDir);
console.log(JSON.stringify({
  ok: true,
  sqlitePath: config.sqlitePath,
  migrationsDir,
  applied
}, null, 2));

