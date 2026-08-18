import { createHash, randomBytes } from "node:crypto";

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

export function sessionCookie(token, config, maxAgeSeconds = 60 * 60 * 24 * 14) {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `ofa_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(config) {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `ofa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function csrfCookie(token, config, maxAgeSeconds = 60 * 60 * 24 * 14) {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `ofa_csrf=${encodeURIComponent(token)}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearCsrfCookie(config) {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `ofa_csrf=; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function createCsrfToken() {
  return randomBytes(32).toString("base64url");
}

export function digestCsrfToken(token, pepper = "") {
  return createHash("sha256").update(`csrf:${pepper}:${token}`).digest("hex");
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

export function publicAccount(account) {
  return {
    username: account.username_display,
    archiveIdentity: account.archive_designation ? { designation: account.archive_designation } : null
  };
}

