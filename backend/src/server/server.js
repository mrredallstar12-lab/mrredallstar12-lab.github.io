import { createServer } from "node:http";
import { Readable } from "node:stream";
import { router } from "../index.js";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { loadServerConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { serveStatic } from "./static-files.js";

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

if (import.meta.url === `file://${process.argv[1]}`) {
  startOFAStagingServer();
}

