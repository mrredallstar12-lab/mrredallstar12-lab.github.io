import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOFAStagingServer, isDirectRun } from "../src/server/server.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const backendDir = dirname(testDir);
const serverEntry = join(backendDir, "src", "server", "server.js");
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-static-"));
writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>OFA static</title>");
const sqliteDir = mkdtempSync(join(tmpdir(), "ofa-sqlite-"));

const directRunPath = join(staticRoot, "server.js");
const directRunUrl = pathToFileURL(directRunPath).href;
assert.equal(isDirectRun(directRunUrl, directRunPath), true);
assert.equal(isDirectRun(directRunUrl, join(staticRoot, "other.js")), false);

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

  const childStarted = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: backendDir,
      env: {
        ...process.env,
        OFA_HOST: "127.0.0.1",
        OFA_PORT: "0",
        OFA_STATIC_ROOT: staticRoot,
        OFA_SQLITE_PATH: join(sqliteDir, "direct-start.sqlite"),
        OFA_LOG_LEVEL: "info"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("direct startup did not log readiness"));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("ofa_staging_server_started")) {
        clearTimeout(timer);
        child.kill();
        resolve(true);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code && code !== 0 && code !== 1) {
        clearTimeout(timer);
        reject(new Error(`direct startup exited unexpectedly: ${code}`));
      }
    });
  });
  assert.equal(childStarted, true);
  console.log("server staging skeleton tests passed");
} finally {
  runtime.server.close();
}
