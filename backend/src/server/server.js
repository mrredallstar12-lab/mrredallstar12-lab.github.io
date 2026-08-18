import { createServer } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { router } from "../index.js";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { loadServerConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { serveStatic } from "./static-files.js";
import { handleAccountApi, isStagingEnabled } from "./account-api.js";
import { adminControlPage } from "./admin-control-page.js";
import { handleAdminApi, isAdminPageAllowed } from "./admin-api.js";
import { handleArchiveApi } from "./archive-api.js";
import { stagingArchivePage } from "./staging-archive-page.js";
import { stagingAccountPage } from "./staging-account-page.js";

function requestUrl(request, config) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `${config.host}:${config.port}`;
  return `${proto}://${host}${request.url || "/"}`;
}

function toFetchRequest(request, config) {
  const method = request.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, String(value));
  }

  const init = { method, headers };
  if (!["GET", "HEAD"].includes(method)) {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(requestUrl(request, config), init);
}

async function writeFetchResponse(nodeResponse, fetchResponse) {
  nodeResponse.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()));
  if (fetchResponse.body) {
    const stream = Readable.fromWeb(fetchResponse.body);
    stream.pipe(nodeResponse);
  } else {
    nodeResponse.end();
  }
}

function buildWorkerEnv(config, logger) {
  const workerEnv = { ...config.workerEnv };
  if (config.sqlitePath) {
    workerEnv.DB = new SQLiteD1Adapter(config.sqlitePath);
    logger.info("sqlite_adapter_ready", { pathConfigured: true });
  }
  return workerEnv;
}

export function createOFAStagingServer(options = {}) {
  const config = options.config || loadServerConfig(options);
  const logger = options.logger || createLogger(config.logLevel);
  const workerEnv = options.workerEnv || buildWorkerEnv(config, logger);

  const server = createServer(async (request, response) => {
    const started = Date.now();
    const url = new URL(requestUrl(request, config));
    try {
      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        const fetchRequest = toFetchRequest(request, config);
        const fetchResponse = await router(fetchRequest, workerEnv);
        await writeFetchResponse(response, fetchResponse);
      } else if (url.pathname.startsWith("/api/v1/admin/")) {
        const fetchRequest = toFetchRequest(request, config);
        const fetchResponse = await handleAdminApi(fetchRequest, workerEnv, config, logger);
        if (fetchResponse) await writeFetchResponse(response, fetchResponse);
        else {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: { code: "admin_route_not_found", message: "Admin route not found." } }));
        }
      } else if (url.pathname.startsWith("/api/v1/archive/")) {
        const fetchRequest = toFetchRequest(request, config);
        const fetchResponse = await handleArchiveApi(fetchRequest, workerEnv, config, logger);
        if (fetchResponse) await writeFetchResponse(response, fetchResponse);
        else {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: { code: "route_not_found", message: "Archive API route not found." } }));
        }
      } else if (url.pathname.startsWith("/api/v1/auth/") || url.pathname.startsWith("/api/v1/me") || url.pathname.startsWith("/api/v1/staging/")) {
        const fetchRequest = toFetchRequest(request, config);
        const fetchResponse = await handleAccountApi(fetchRequest, workerEnv, config, logger);
        if (fetchResponse) await writeFetchResponse(response, fetchResponse);
        else {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: { code: "route_not_found", message: "Archive API route not found." } }));
        }
      } else if (url.pathname === "/staging/account-test.html") {
        if (!isStagingEnabled(config)) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
        } else {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(stagingAccountPage());
        }
      } else if (url.pathname === "/staging/archive-test.html") {
        if (!isStagingEnabled(config)) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
        } else {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(stagingArchivePage());
        }
      } else if (url.pathname === "/admin/control-center.html") {
        const fetchRequest = toFetchRequest(request, config);
        if (!(await isAdminPageAllowed(fetchRequest, workerEnv, config))) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          response.end("Not found");
        } else {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(adminControlPage(config));
        }
      } else if (url.pathname.startsWith("/api/")) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: { code: "api_route_not_enabled", message: "Only staging health is enabled in this server skeleton." } }));
      } else {
        serveStatic(request, response, config.staticRoot);
      }
      logger.info("request", {
        method: request.method,
        path: url.pathname,
        status: response.statusCode,
        durationMs: Date.now() - started
      });
    } catch (error) {
      logger.error("request_failed", {
        method: request.method,
        path: url.pathname,
        durationMs: Date.now() - started,
        error: error.message
      });
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: { code: "server_error", message: "Staging server error." } }));
    }
  });

  return { server, config, logger, workerEnv };
}

export function startOFAStagingServer(options = {}) {
  const runtime = createOFAStagingServer(options);
  runtime.server.listen(runtime.config.port, runtime.config.host, () => {
    runtime.logger.info("ofa_staging_server_started", {
      env: runtime.config.envName,
      host: runtime.config.host,
      port: runtime.config.port,
      staticRoot: runtime.config.staticRoot,
      sqliteConfigured: !!runtime.config.sqlitePath
    });
  });
  return runtime;
}

export function isDirectRun(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(argvPath);
  } catch {
    return false;
  }
}

if (isDirectRun(import.meta.url)) {
  startOFAStagingServer();
}
