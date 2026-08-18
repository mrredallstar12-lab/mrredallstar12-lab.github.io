import { copySQLiteStorageForMigration } from "./storage-migration.js";

const result = await copySQLiteStorageForMigration({
  sourcePath: process.env.OFA_STORAGE_MIGRATION_SOURCE,
  destinationPath: process.env.OFA_STORAGE_MIGRATION_DESTINATION,
  confirm: process.env.OFA_STORAGE_MIGRATION_CONFIRM
});

console.log(JSON.stringify(result, null, 2));

