import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";

class AsyncMutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(work) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolvePromise) => { release = resolvePromise; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

class SQLiteStatement {
  constructor(adapter, sql, bindings = []) {
    this.adapter = adapter;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...values) {
    return new SQLiteStatement(this.adapter, this.sql, values);
  }

  async first() {
    return await this.adapter.execute(() => this.adapter.database.prepare(this.sql).get(...this.bindings) || null);
  }

  async all() {
    return await this.adapter.execute(() => ({ results: this.adapter.database.prepare(this.sql).all(...this.bindings) }));
  }

  async run() {
    return await this.adapter.execute(() => {
      const result = this.adapter.database.prepare(this.sql).run(...this.bindings);
      return {
        success: true,
        meta: {
          changes: result.changes,
          last_row_id: result.lastInsertRowid ? Number(result.lastInsertRowid) : undefined
        }
      };
    });
  }
}

export class SQLiteD1Adapter {
  constructor(filePath) {
    if (!filePath) throw new Error("SQLite database path is required.");
    this.filePath = resolve(filePath);
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.mutex = new AsyncMutex();
    this.transactionContext = new AsyncLocalStorage();
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
  }

  prepare(sql) {
    return new SQLiteStatement(this, sql);
  }

  async execute(work) {
    if (this.transactionContext.getStore()?.adapter === this) return work();
    return await this.mutex.run(work);
  }

  async withTransaction(work) {
    if (this.transactionContext.getStore()?.adapter === this) return await work(this);
    return await this.mutex.run(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await this.transactionContext.run({ adapter: this }, () => work(this));
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
  }

  exec(sql) {
    this.database.exec(sql);
  }

  transaction(fn) {
    if (this.transactionContext.getStore()?.adapter === this) return fn();
    this.database.exec("BEGIN");
    try {
      const result = fn();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
