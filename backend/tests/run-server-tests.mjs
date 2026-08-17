import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOFAStagingServer } from "../src/server/server.js";

const staticRoot = mkdtempSync(join(tmpdir(), "ofa-static-"));
writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>OFA static</title>");
const sqliteDir = mkdtempSync(join(tmpdir(), "ofa-sqlite-"));

const logs = [];
const logger = {
  debug: (message, detail) => logs.push({ level: "debug", message, detail }),
  info: (message, detail) => logs.push({ level: "info", message, detail }),
  warn: (message, detail) => logs.push({ level: "warn", message, detail }),
  error: (message, detail) => logs.push({ level: "error", message, detail })
};

const runtime = createOFAStagingServer({
  config: {
    envName: "test",
    host: "127.0.0.1",
    port: 0,
    staticRoot,
    logLevel: "debug",
    sqlitePath: join(sqliteDir, "staging.sqlite"),
    workerEnv: {
      OFA_ALLOWED_ORIGINS: "http://127.0.0.1"
    }
  },
  logger
});

runtime.server.listen(0, "127.0.0.1");
await once(runtime.server, "listening");
const { port } = runtime.server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const health = await fetch(`${base}/api/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.version, "v1");
  assert.equal(healthBody.db, true);

  const disabled = await fetch(`${base}/api/v1/config`);
  assert.equal(disabled.status, 404);
  assert.equal((await disabled.json()).error.code, "api_route_not_enabled");

  const homepage = await fetch(`${base}/`);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /OFA static/);

  assert.equal(logs.some((entry) => entry.message === "request"), true);
  console.log("server staging skeleton tests passed");
} finally {
  runtime.server.close();
}
