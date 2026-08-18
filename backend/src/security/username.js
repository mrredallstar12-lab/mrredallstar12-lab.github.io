const RESERVED = new Set([
  "admin",
  "administrator",
  "archive",
  "codex",
  "help",
  "moderator",
  "ofa",
  "official",
  "owner",
  "root",
  "staff",
  "support",
  "system"
]);

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function validateUsername(username) {
  const display = String(username || "").trim();
  const normalized = normalizeUsername(display);
  if (display.length < 3 || display.length > 24) return { ok: false, code: "invalid_username", message: "Username must be 3-24 characters." };
  if (!/^[A-Za-z0-9_-]+$/.test(display)) return { ok: false, code: "invalid_username", message: "Username may contain letters, numbers, underscore, or hyphen." };
  if (RESERVED.has(normalized)) return { ok: false, code: "reserved_username", message: "That username is reserved." };
  return { ok: true, display, normalized };
}

export { RESERVED as RESERVED_USERNAMES };

