import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const out = {};
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadServerConfig(options = {}) {
  const envFile = options.envFile || process.env.OFA_ENV_FILE || ".env.server";
  const fileEnv = parseEnvFile(resolve(envFile));
  const env = { ...fileEnv, ...process.env };
  const staticRoot = resolve(env.OFA_STATIC_ROOT || "..");

  return {
    envName: env.OFA_ENV || "staging",
    host: env.OFA_HOST || "127.0.0.1",
    port: Number(env.OFA_PORT || 8080),
    staticRoot,
    logLevel: env.OFA_LOG_LEVEL || "info",
    sqlitePath: env.OFA_SQLITE_PATH ? resolve(env.OFA_SQLITE_PATH) : "",
    storageRoot: env.OFA_STORAGE_ROOT ? resolve(env.OFA_STORAGE_ROOT) : "",
    mediaRoot: env.OFA_MEDIA_ROOT ? resolve(env.OFA_MEDIA_ROOT) : "",
    uploadRoot: env.OFA_UPLOAD_ROOT ? resolve(env.OFA_UPLOAD_ROOT) : "",
    runtimeRoot: env.OFA_RUNTIME_ROOT ? resolve(env.OFA_RUNTIME_ROOT) : "",
    logRoot: env.OFA_LOG_ROOT ? resolve(env.OFA_LOG_ROOT) : "",
    backupRoot: env.OFA_BACKUP_ROOT ? resolve(env.OFA_BACKUP_ROOT) : "",
    sessionPepper: env.OFA_SESSION_PEPPER || "",
    identityPepper: env.OFA_IDENTITY_PEPPER || "",
    fieldEncryptionKey: env.OFA_FIELD_ENCRYPTION_KEY_B64 || "",
    fieldEncryptionKeyId: env.OFA_FIELD_ENCRYPTION_KEY_ID || "env:v1",
    sessionTtlSeconds: Number(env.OFA_SESSION_TTL_SECONDS || 60 * 60 * 24 * 14),
    cookieSecure: String(env.OFA_COOKIE_SECURE || "false").toLowerCase() === "true",
    localEmailLinksEnabled: String(env.OFA_LOCAL_EMAIL_LINKS_ENABLED || "false").toLowerCase() === "true",
    workerEnv: {
      OFA_API_VERSION: env.OFA_API_VERSION || "v1",
      OFA_PUBLIC_BASE_URL: env.OFA_PUBLIC_BASE_URL || `http://${env.OFA_HOST || "127.0.0.1"}:${Number(env.OFA_PORT || 8080)}`,
      OFA_ALLOWED_ORIGINS: env.OFA_ALLOWED_ORIGINS || "",
      OFA_TURNSTILE_REQUIRED: env.OFA_TURNSTILE_REQUIRED || "false",
      ADMIN_TOKEN: env.ADMIN_TOKEN || "",
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY || ""
    }
  };
}
