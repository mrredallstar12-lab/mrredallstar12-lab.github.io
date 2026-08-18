import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";

const db = new SQLiteD1Adapter(join(mkdtempSync(join(tmpdir(), "ofa-transaction-")), "transaction.sqlite"));
db.exec("CREATE TABLE values_test (id TEXT PRIMARY KEY, value INTEGER NOT NULL)");

try {
  let releaseTransaction;
  let inserted;
  const insertedSignal = new Promise((resolve) => { inserted = resolve; });
  const transactionGate = new Promise((resolve) => { releaseTransaction = resolve; });

  const transaction = db.withTransaction(async (tx) => {
    await tx.prepare("INSERT INTO values_test (id, value) VALUES ('held', 1)").run();
    inserted();
    await transactionGate;
    await tx.prepare("UPDATE values_test SET value = 2 WHERE id = 'held'").run();
  });

  await insertedSignal;
  let outsideReadResolved = false;
  const outsideRead = db.prepare("SELECT value FROM values_test WHERE id = 'held'").first().then((row) => {
    outsideReadResolved = true;
    return row;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(outsideReadResolved, false);
  releaseTransaction();
  await transaction;
  assert.equal((await outsideRead).value, 2);

  await assert.rejects(
    () => db.withTransaction(async (tx) => {
      await tx.prepare("INSERT INTO values_test (id, value) VALUES ('rollback', 1)").run();
      throw new Error("forced_rollback");
    }),
    /forced_rollback/
  );
  assert.equal(await db.prepare("SELECT value FROM values_test WHERE id = 'rollback'").first(), null);

  await db.withTransaction(async (tx) => {
    await tx.prepare("INSERT INTO values_test (id, value) VALUES ('nested', 1)").run();
    await tx.withTransaction(async (nested) => {
      await nested.prepare("UPDATE values_test SET value = 2 WHERE id = 'nested'").run();
    });
  });
  assert.equal((await db.prepare("SELECT value FROM values_test WHERE id = 'nested'").first()).value, 2);

  await Promise.all(Array.from({ length: 20 }, (_, index) => db.withTransaction(async (tx) => {
    await tx.prepare("INSERT INTO values_test (id, value) VALUES (?, ?)").bind(`concurrent-${index}`, index).run();
  })));
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM values_test WHERE id LIKE 'concurrent-%'").first()).count, 20);

  console.log("transaction context tests passed");
} finally {
  db.close();
}
