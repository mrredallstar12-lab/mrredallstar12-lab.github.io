import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function digestSessionToken(token, pepper = "") {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

export function sessionTokenMatches(token, digest, pepper = "") {
  const next = digestSessionToken(token, pepper);
  const a = Buffer.from(next, "hex");
  const b = Buffer.from(String(digest || ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function csrfTokenForSession(sessionId, secret = "") {
  return createHash("sha256").update(`csrf:${secret}:${sessionId}`).digest("base64url");
}

