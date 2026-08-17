import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

class SQLiteStatement {
  constructor(statement, bindings = []) {
    this.statement = statement;
    this.bindings = bindings;
  }

  bind(...values) {
    return new SQLiteStatement(this.statement, values);
  }

  async first() {
    return this.statement.get(...this.bindings) || null;
  }

  async all() {
    return { results: this.statement.all(...this.bindings) };
  }

  async run() {
    const result = this.statement.run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid ? Number(result.lastInsertRowid) : undefined
      }
    };
  }
}

export class SQLiteD1Adapter {
  constructor(filePath) {
    if (!filePath) throw new Error("SQLite database path is required.");
    this.filePath = resolve(filePath);
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql) {
    return new SQLiteStatement(this.database.prepare(sql));
  }

  close() {
    this.database.close();
  }
}

