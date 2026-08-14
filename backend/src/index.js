const API_VERSION = "v1";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://oddfrequencyarchive.com",
  "https://www.oddfrequencyarchive.com",
  "https://mrredallstar12-lab.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
];

const EVENT_TYPES = new Set([
  "popup_close",
  "radio_tune",
  "crt_tune",
  "alchemy_attempt",
  "objective_progress",
  "creature_feed",
  "room_open",
  "daily_signal_claim",
  "case_conclusion",
  "archive_echo"
]);

const SUBMISSION_TYPES = new Set(["rumor", "sighting", "object", "message", "drawing-note"]);
const CONDITIONS = new Set(["stable", "interference", "contaminated", "emergency-broadcast", "basement-awake"]);
const WEATHER = new Set(["popup-rain", "heavy-static", "coupon-winds", "blood-red-buffering", "pixel-fog", "modem-pressure", "clear-signal"]);

export function allowedOrigins(env = {}) {
  const configured = String(env.OFA_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

export function normalizeOrigin(origin = "") {
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return `${url.protocol}//${url.host}`;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return "";
  }
}

export function isAllowedOrigin(origin, env = {}) {
  if (!origin) return false;
  return allowedOrigins(env).includes(normalizeOrigin(origin));
}

export function cleanText(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function publicVisitorLabel(visitorId = "") {
  const clean = String(visitorId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  if (!clean) return "VISITOR ???";
  let n = 0;
  for (const ch of clean) n = (n * 31 + ch.charCodeAt(0)) % 9000;
  return `VISITOR ${String(1000 + n).slice(-4)}`;
}

export function validateVisitorId(visitorId = "") {
  return /^[a-zA-Z0-9_-]{12,80}$/.test(String(visitorId));
}

export function validateEventPayload(body = {}) {
  const type = cleanText(body.type, 60);
  if (!EVENT_TYPES.has(type)) return { ok: false, error: "unsupported_event_type" };
  const visitorId = cleanText(body.visitorId, 90);
  if (visitorId && !validateVisitorId(visitorId)) return { ok: false, error: "invalid_visitor_id" };
  return {
    ok: true,
    event: {
      type,
      visitorId,
      message: cleanText(body.message || eventMessage(type, body), 180),
      payload: scrubPayload(body.payload || {}),
      amount: Math.max(1, Math.min(25, Number(body.amount || 1))),
      idempotencyKey: cleanText(body.idempotencyKey || "", 96)
    }
  };
}

export function eventMessage(type, body = {}) {
  const label = publicVisitorLabel(body.visitorId);
  const popupType = cleanText(body.payload?.popupType || "UNKNOWN_RECTANGLE", 50);
  const station = cleanText(body.payload?.station || "unknown station", 50);
  const item = cleanText(body.payload?.item || "archive junk", 50);
  const messages = {
    popup_close: `${label} CLOSED ${popupType}.`,
    radio_tune: `${label} TUNED ${station}.`,
    crt_tune: `${label} MOVED THE CRT DIAL.`,
    alchemy_attempt: `${label} TESTED A WORKBENCH COMBINATION.`,
    objective_progress: `${label} PUSHED A SHARED OBJECTIVE.`,
    creature_feed: `${label} FED ${item} TO THE ARCHIVE CREATURE.`,
    room_open: `${label} OPENED A TEMPORARY ROOM.`,
    daily_signal_claim: `${label} CLAIMED THE DAILY SIGNAL.`,
    case_conclusion: `${label} FILED A CASE CONCLUSION.`,
    archive_echo: `${label} MADE THE ARCHIVE ECHO.`
  };
  return messages[type] || `${label} TOUCHED THE ARCHIVE.`;
}

export function scrubPayload(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (/ip|email|name|address|phone|location|fingerprint/i.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = cleanText(value, 180);
  }
  return out;
}

export function fallbackSignal(date = new Date()) {
  const key = date.toISOString().slice(0, 10);
  const bits = [
    ["Transmission A-404", "A shared signal tapped the glass three times.", "Static Coin"],
    ["Coupon weather advisory", "Zero percent winds are moving east.", "Coupon Dust Jar"],
    ["Basement clock memo", "The public archive must remain loud.", "Fake Patch Note"],
    ["Radio clue", "CH 404 repeats: do not complete the person.", "Radio Static Sample"],
    ["Employee reminder", "Clock in only if the badge remembers you.", "Door Knock Receipt"]
  ];
  const index = Number(key.replace(/-/g, "")) % bits.length;
  const [artifact, transmission, reward] = bits[index];
  return {
    dateKey: key,
    artifact,
    transmission,
    rumor: "The same signal is visible to everyone when the backend is available.",
    corruptedMessage: index === 3 ? "CASE 000 is not a search." : "",
    reward: { item: reward, currency: ["Static Coins", 2] },
    weatherEffect: ["clear-signal", "pixel-fog", "coupon-winds"][index % 3],
    roomKey: index === 4 ? "employee-terminal" : "none",
    source: "local-fallback"
  };
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-OFA-Visitor",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (isAllowedOrigin(origin, env)) headers["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
  return headers;
}

function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(request, env) });
}

function error(request, env, status, code, message, detail = {}) {
  return json({ ok: false, error: { code, message, detail } }, request, env, status);
}

async function readBody(request) {
  if (!request.body) return {};
  const text = await request.text();
  if (!text) return {};
  if (text.length > 16000) return { __tooLarge: true };
  return safeJsonParse(text, { __invalidJson: true });
}

async function visitorHash(value) {
  const input = new TextEncoder().encode(String(value || "anonymous"));
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function rateLimit(env, bucket, limit = 30, windowSeconds = 60) {
  if (!env.DB) return { ok: true, fallback: true };
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;
  const row = await env.DB.prepare("SELECT count, reset_at FROM rate_limits WHERE bucket_key = ?").bind(bucket).first();
  if (!row || Number(row.reset_at) <= now) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (bucket_key, count, reset_at) VALUES (?, 1, ?)").bind(bucket, resetAt).run();
    return { ok: true };
  }
  if (Number(row.count) >= limit) return { ok: false, resetAt: row.reset_at };
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?").bind(bucket).run();
  return { ok: true };
}

function requireDb(request, env) {
  if (!env.DB) return error(request, env, 503, "db_unavailable", "Shared archive database is not configured.");
  return null;
}

async function latestRows(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return result.results || [];
}

async function handleGetSignal(request, env) {
  if (!env.DB) return json({ ok: true, signal: fallbackSignal(), backend: false }, request, env);
  const dateKey = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT * FROM daily_signals WHERE date_key = ? OR date_key = 'fallback' ORDER BY CASE WHEN date_key = ? THEN 0 ELSE 1 END LIMIT 1").bind(dateKey, dateKey).first();
  const signal = row ? {
    dateKey,
    transmission: row.transmission,
    artifact: row.artifact,
    rumor: row.rumor,
    corruptedMessage: row.corrupted_message,
    reward: safeJsonParse(row.reward_json, {}),
    weatherEffect: row.weather_effect,
    roomKey: row.room_key,
    source: row.date_key === dateKey ? "server" : "server-fallback"
  } : fallbackSignal();
  return json({ ok: true, signal, backend: true }, request, env);
}

async function handleCondition(request, env) {
  if (!env.DB) return json({ ok: true, condition: { key: "stable", label: "Stable", detail: "Local fallback condition.", source: "local-fallback" } }, request, env);
  const row = await env.DB.prepare("SELECT condition_key, label, detail FROM archive_conditions WHERE ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1").first();
  return json({ ok: true, condition: row ? { key: row.condition_key, label: row.label, detail: row.detail, source: "server" } : { key: "stable", label: "Stable", detail: "No active shared condition.", source: "server-fallback" } }, request, env);
}

async function handleWeather(request, env) {
  if (!env.DB) return json({ ok: true, weather: { key: "clear-signal", label: "Clear signal", detail: "Local fallback weather.", intensity: 1 } }, request, env);
  const row = await env.DB.prepare("SELECT weather_key, label, detail, intensity FROM archive_weather WHERE ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1").first();
  return json({ ok: true, weather: row ? { key: row.weather_key, label: row.label, detail: row.detail, intensity: row.intensity } : { key: "clear-signal", label: "Clear signal", detail: "No active shared weather.", intensity: 1 } }, request, env);
}

async function handleActivity(request, env) {
  if (!env.DB) return json({ ok: true, events: [{ message: "LOCAL FALLBACK: shared feed unavailable, archive still works.", eventType: "local" }], backend: false }, request, env);
  const rows = await latestRows(env, "SELECT event_type, visitor_label, message, created_at FROM activity_events ORDER BY id DESC LIMIT 25");
  return json({ ok: true, events: rows.map((row) => ({ eventType: row.event_type, visitor: row.visitor_label, message: row.message, createdAt: row.created_at })), backend: true }, request, env);
}

async function handleEvent(request, env) {
  const dbError = requireDb(request, env);
  if (dbError) return dbError;
  const body = await readBody(request);
  if (body.__tooLarge) return error(request, env, 413, "body_too_large", "Event body is too large.");
  if (body.__invalidJson) return error(request, env, 400, "invalid_json", "Request body must be valid JSON.");
  const validation = validateEventPayload(body);
  if (!validation.ok) return error(request, env, 400, validation.error, "Event payload failed validation.");
  const visitorId = validation.event.visitorId || request.headers.get("X-OFA-Visitor") || "anonymous";
  const hash = await visitorHash(visitorId);
  const limited = await rateLimit(env, `event:${hash}`, 40, 60);
  if (!limited.ok) return error(request, env, 429, "rate_limited", "Too many archive events. Wait for the static to cool.", { resetAt: limited.resetAt });
  const label = publicVisitorLabel(visitorId);
  await env.DB.prepare("INSERT INTO activity_events (event_type, visitor_label, message, payload_json) VALUES (?, ?, ?, ?)")
    .bind(validation.event.type, label, validation.event.message, JSON.stringify(validation.event.payload)).run();
  if (validation.event.type === "popup_close") {
    const popupType = cleanText(validation.event.payload.popupType || "UNKNOWN_RECTANGLE", 60);
    await env.DB.prepare("INSERT INTO popup_graveyard_totals (popup_type, closed_count, last_closed_at) VALUES (?, 1, CURRENT_TIMESTAMP) ON CONFLICT(popup_type) DO UPDATE SET closed_count = closed_count + 1, last_closed_at = CURRENT_TIMESTAMP").bind(popupType).run();
  }
  if (["popup_close", "radio_tune", "alchemy_attempt", "creature_feed"].includes(validation.event.type)) {
    await incrementObjective(env, validation.event.type, validation.event.amount, hash, validation.event.idempotencyKey);
  }
  return json({ ok: true, accepted: true }, request, env, 202);
}

async function incrementObjective(env, objectiveType, amount, visitorHashValue, idempotencyKey = "") {
  const objective = await env.DB.prepare("SELECT id, current_value, target_value FROM objectives WHERE objective_type = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(objectiveType).first();
  if (!objective) return;
  if (idempotencyKey) {
    try {
      await env.DB.prepare("INSERT INTO objective_contributions (objective_id, visitor_hash, amount, idempotency_key) VALUES (?, ?, ?, ?)").bind(objective.id, visitorHashValue, amount, idempotencyKey).run();
    } catch {
      return;
    }
  }
  const next = Math.min(Number(objective.target_value), Number(objective.current_value) + amount);
  const status = next >= Number(objective.target_value) ? "complete" : "active";
  await env.DB.prepare("UPDATE objectives SET current_value = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(next, status, objective.id).run();
}

async function handlePopupTotals(request, env) {
  if (!env.DB) return json({ ok: true, totals: [], backend: false }, request, env);
  const rows = await latestRows(env, "SELECT popup_type, closed_count, last_closed_at FROM popup_graveyard_totals ORDER BY closed_count DESC LIMIT 50");
  return json({ ok: true, totals: rows }, request, env);
}

async function handleObjectives(request, env) {
  if (!env.DB) return json({ ok: true, objectives: fallbackObjectives(), backend: false }, request, env);
  const rows = await latestRows(env, "SELECT id, title, description, objective_type, target_value, current_value, reward_json, status FROM objectives ORDER BY created_at DESC LIMIT 10");
  return json({ ok: true, objectives: rows.map((row) => ({ ...row, reward: safeJsonParse(row.reward_json, {}) })), backend: true }, request, env);
}

function fallbackObjectives() {
  return [
    { id: "local-close-popups", title: "Local fallback: close 25 fake popups", objective_type: "popup_close", target_value: 25, current_value: 0, status: "local" }
  ];
}

async function handleCreature(request, env) {
  if (!env.DB) return json({ ok: true, creature: fallbackCreature(), backend: false }, request, env);
  const row = await env.DB.prepare("SELECT designation, hunger, mood, stage, modifiers_json, containment_sensitivity, updated_at FROM creature_state WHERE id = 1").first();
  const recent = await latestRows(env, "SELECT item_name, amount, created_at FROM creature_feed ORDER BY id DESC LIMIT 8");
  return json({ ok: true, creature: row ? { designation: row.designation, hunger: row.hunger, mood: row.mood, stage: row.stage, modifiers: safeJsonParse(row.modifiers_json, []), containmentSensitivity: row.containment_sensitivity, updatedAt: row.updated_at, recent } : fallbackCreature(), backend: true }, request, env);
}

function fallbackCreature() {
  return { designation: "Specimen LOCAL-FEED", hunger: 66, mood: "waiting for backend crumbs", stage: 1, modifiers: ["paper teeth"], recent: [] };
}

async function handleCreatureFeed(request, env) {
  const dbError = requireDb(request, env);
  if (dbError) return dbError;
  const body = await readBody(request);
  if (body.__invalidJson) return error(request, env, 400, "invalid_json", "Request body must be valid JSON.");
  const visitorId = cleanText(body.visitorId, 90);
  if (!validateVisitorId(visitorId)) return error(request, env, 400, "invalid_visitor_id", "Visitor ID is missing or invalid.");
  const hash = await visitorHash(visitorId);
  const limited = await rateLimit(env, `feed:${hash}`, 12, 60);
  if (!limited.ok) return error(request, env, 429, "rate_limited", "Creature feeding paused. The specimen is chewing.");
  const item = cleanText(body.itemName, 80);
  if (!item) return error(request, env, 400, "missing_item", "Feed item is required.");
  const amount = Math.max(1, Math.min(5, Number(body.amount || 1)));
  const idempotencyKey = cleanText(body.idempotencyKey || crypto.randomUUID(), 96);
  try {
    await env.DB.prepare("INSERT INTO creature_feed (visitor_hash, item_name, amount, idempotency_key) VALUES (?, ?, ?, ?)").bind(hash, item, amount, idempotencyKey).run();
  } catch {
    return json({ ok: true, duplicate: true }, request, env);
  }
  await env.DB.prepare("UPDATE creature_state SET hunger = MAX(0, hunger - ?), mood = CASE WHEN hunger - ? < 25 THEN 'temporarily satisfied' ELSE mood END, updated_at = CURRENT_TIMESTAMP WHERE id = 1").bind(amount * 3, amount * 3).run();
  await incrementObjective(env, "creature_feed", amount, hash, idempotencyKey);
  await env.DB.prepare("INSERT INTO activity_events (event_type, visitor_label, message, payload_json) VALUES ('creature_feed', ?, ?, ?)").bind(publicVisitorLabel(visitorId), eventMessage("creature_feed", { visitorId, payload: { item } }), JSON.stringify({ item })).run();
  return json({ ok: true, accepted: true }, request, env, 202);
}

async function handleAlchemyRecipes(request, env) {
  const fallback = [
    { id: "server-rotating-static-needle", name: "Rotating Static Needle", inputs: ["Radio Static Sample", "Static Coin"], output: "Community Static Needle", source: "fallback" },
    { id: "server-contaminated-coupon", name: "Contaminated Coupon", inputs: ["Coupon Dust Jar", "Case Smudge"], output: "Contaminated Coupon Witness", source: "fallback" }
  ];
  if (!env.DB) return json({ ok: true, recipes: fallback, backend: false }, request, env);
  const rows = await latestRows(env, "SELECT combo_hash, inputs_json, output_name, result_type, created_at FROM alchemy_community_records ORDER BY id DESC LIMIT 20");
  return json({ ok: true, recipes: fallback, communityRecords: rows.map((row) => ({ ...row, inputs: safeJsonParse(row.inputs_json, []) })), backend: true }, request, env);
}

async function handleAlchemyRecord(request, env) {
  const dbError = requireDb(request, env);
  if (dbError) return dbError;
  const body = await readBody(request);
  const inputs = Array.isArray(body.inputs) ? body.inputs.map((v) => cleanText(v, 80)).filter(Boolean).slice(0, 5) : [];
  if (inputs.length < 2) return error(request, env, 400, "invalid_inputs", "At least two safe item names are required.");
  const hash = await visitorHash(inputs.slice().sort().join("|"));
  await env.DB.prepare("INSERT INTO alchemy_community_records (combo_hash, inputs_json, output_name, result_type, visitor_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(hash, JSON.stringify(inputs), cleanText(body.outputName, 80), cleanText(body.resultType || "attempt", 30), await visitorHash(body.visitorId || "anonymous")).run();
  await incrementObjective(env, "alchemy_attempt", 1, await visitorHash(body.visitorId || "anonymous"), cleanText(body.idempotencyKey || "", 96));
  return json({ ok: true, accepted: true }, request, env, 202);
}

async function handleCases(request, env, id) {
  if (!env.DB) return json({ ok: true, cases: fallbackCases(), backend: false }, request, env);
  if (id) {
    const row = await env.DB.prepare("SELECT * FROM case_files WHERE id = ?").bind(id).first();
    if (!row) return error(request, env, 404, "case_not_found", "Case file not found.");
    const fragments = await latestRows(env, "SELECT id, stage_required, title, body, data_json FROM case_fragments WHERE case_id = ? AND published = 1 ORDER BY stage_required, created_at", [id]);
    return json({ ok: true, caseFile: caseRow(row), fragments: fragments.map((f) => ({ ...f, data: safeJsonParse(f.data_json, {}) })) }, request, env);
  }
  const rows = await latestRows(env, "SELECT id, subject_name, fictional_age, fictional_location, intake_date, status, assigned_employee, summary, restricted, coherence_weight, data_json FROM case_files ORDER BY restricted, id");
  return json({ ok: true, cases: rows.map(caseRow), backend: true }, request, env);
}

function caseRow(row) {
  return {
    id: row.id,
    subjectName: row.subject_name,
    fictionalAge: row.fictional_age,
    fictionalLocation: row.fictional_location,
    intakeDate: row.intake_date,
    status: row.status,
    assignedEmployee: row.assigned_employee,
    summary: row.summary,
    restricted: !!row.restricted,
    coherenceWeight: row.coherence_weight,
    data: safeJsonParse(row.data_json, {})
  };
}

function fallbackCases() {
  return [
    { id: "case-017", subjectName: "Elian Rook", fictionalAge: "29", fictionalLocation: "Barrow Glass Exchange", status: "open", summary: "Fictional projectionist file. Backend unavailable; local index only." },
    { id: "case-031", subjectName: "Nessa Quill", fictionalAge: "17", fictionalLocation: "Juniper Switchboard School", status: "contradictory", summary: "Fictional school record file. Backend unavailable; local index only." },
    { id: "case-044", subjectName: "Milo Venn", fictionalAge: "42", fictionalLocation: "Civic Aquarium Annex", status: "photographic replacement", summary: "Fictional maintenance file. Backend unavailable; local index only." },
    { id: "case-000", subjectName: "Mara Vale", fictionalAge: "unverified", fictionalLocation: "location must not stabilize", status: "restricted", restricted: true, summary: "Case 000 prevents a location from becoming real." }
  ];
}

async function handleCaseConclusion(request, env, id) {
  const dbError = requireDb(request, env);
  if (dbError) return dbError;
  const body = await readBody(request);
  const visitorId = cleanText(body.visitorId, 90);
  if (!validateVisitorId(visitorId)) return error(request, env, 400, "invalid_visitor_id", "Visitor ID is missing or invalid.");
  const question = cleanText(body.questionKey, 80);
  const answer = cleanText(body.answerKey, 80);
  if (!question || !answer) return error(request, env, 400, "invalid_conclusion", "Question and answer are required.");
  await env.DB.prepare("INSERT OR REPLACE INTO case_conclusions (case_id, question_key, answer_key, visitor_hash, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
    .bind(id, question, answer, await visitorHash(visitorId)).run();
  return json({ ok: true, accepted: true, warning: "Contradiction stabilizes containment. Agreement increases coherence slowly." }, request, env, 202);
}

async function handleSubmission(request, env) {
  const dbError = requireDb(request, env);
  if (dbError) return dbError;
  const body = await readBody(request);
  if (body.__tooLarge) return error(request, env, 413, "body_too_large", "Submission is too large.");
  const turnstile = await verifyTurnstileIfRequired(request, env, body.turnstileToken);
  if (!turnstile.ok) return error(request, env, 403, "turnstile_failed", turnstile.message);
  const type = cleanText(body.type, 30);
  if (!SUBMISSION_TYPES.has(type)) return error(request, env, 400, "invalid_submission_type", "Unsupported submission type.");
  const title = cleanText(body.title, 120);
  const content = cleanText(body.body, 2000);
  if (title.length < 3 || content.length < 10) return error(request, env, 400, "invalid_submission", "Submission title/body are too short.");
  const visitorHashValue = await visitorHash(body.visitorId || "anonymous");
  const limited = await rateLimit(env, `submission:${visitorHashValue}`, 3, 3600);
  if (!limited.ok) return error(request, env, 429, "rate_limited", "Too many submissions. Try later.");
  await env.DB.prepare("INSERT INTO submissions (submission_type, title, body, visitor_hash) VALUES (?, ?, ?, ?)")
    .bind(type, title, content, visitorHashValue).run();
  return json({ ok: true, status: "pending", message: "Submission received for moderation. It is not public yet." }, request, env, 202);
}

async function verifyTurnstileIfRequired(request, env, token) {
  const required = String(env.OFA_TURNSTILE_REQUIRED || "false").toLowerCase() === "true";
  if (!required) return { ok: true, skipped: true };
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, message: "Turnstile is required but not configured." };
  if (!token) return { ok: false, message: "Turnstile token is required for public submissions." };
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", String(token));
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  return result.success ? { ok: true } : { ok: false, message: "Turnstile verification failed." };
}

function requireAdmin(request, env) {
  const token = String(env.ADMIN_TOKEN || "");
  const got = request.headers.get("Authorization") || "";
  return token.length > 20 && got === `Bearer ${token}`;
}

async function handleAdmin(request, env, path) {
  if (!requireAdmin(request, env)) return error(request, env, 401, "admin_auth_required", "Admin endpoint requires a server-side token.");
  if (!env.DB) return error(request, env, 503, "db_unavailable", "Database is not configured.");
  if (request.method === "GET" && path === "/api/v1/admin/submissions") {
    const rows = await latestRows(env, "SELECT id, submission_type, title, body, moderation_status, created_at FROM submissions ORDER BY id DESC LIMIT 50");
    return json({ ok: true, submissions: rows }, request, env);
  }
  if (request.method === "POST" && path === "/api/v1/admin/condition") {
    const body = await readBody(request);
    const key = cleanText(body.conditionKey, 60);
    if (!CONDITIONS.has(key)) return error(request, env, 400, "invalid_condition", "Unsupported archive condition.");
    await env.DB.prepare("INSERT INTO archive_conditions (condition_key, label, detail, ends_at) VALUES (?, ?, ?, ?)").bind(key, cleanText(body.label, 80), cleanText(body.detail, 500), cleanText(body.endsAt, 40) || null).run();
    await env.DB.prepare("INSERT INTO admin_audit (action, detail_json) VALUES ('set_condition', ?)").bind(JSON.stringify({ key })).run();
    return json({ ok: true }, request, env, 202);
  }
  if (request.method === "POST" && path === "/api/v1/admin/weather") {
    const body = await readBody(request);
    const key = cleanText(body.weatherKey, 60);
    if (!WEATHER.has(key)) return error(request, env, 400, "invalid_weather", "Unsupported archive weather.");
    await env.DB.prepare("INSERT INTO archive_weather (weather_key, label, detail, intensity, ends_at) VALUES (?, ?, ?, ?, ?)").bind(key, cleanText(body.label, 80), cleanText(body.detail, 500), Math.max(1, Math.min(5, Number(body.intensity || 1))), cleanText(body.endsAt, 40) || null).run();
    await env.DB.prepare("INSERT INTO admin_audit (action, detail_json) VALUES ('set_weather', ?)").bind(JSON.stringify({ key })).run();
    return json({ ok: true }, request, env, 202);
  }
  return error(request, env, 404, "admin_route_not_found", "Admin route not found.");
}

async function router(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.headers.get("Origin") && !isAllowedOrigin(request.headers.get("Origin"), env)) {
    return error(request, env, 403, "origin_not_allowed", "Origin is not allowed for the shared archive API.");
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/v1/health") return json({ ok: true, version: API_VERSION, db: !!env.DB, r2: !!env.EVIDENCE_BUCKET, now: new Date().toISOString() }, request, env);
  if (path === "/api/v1/config") return json({ ok: true, version: API_VERSION, features: { sharedSignals: true, activityFeed: true, creature: true, cases: true, submissions: true, accounts: "future-optional" } }, request, env);
  if (path === "/api/v1/signal/today") return handleGetSignal(request, env);
  if (path === "/api/v1/condition") return handleCondition(request, env);
  if (path === "/api/v1/weather") return handleWeather(request, env);
  if (path === "/api/v1/activity") return handleActivity(request, env);
  if (path === "/api/v1/events" && request.method === "POST") return handleEvent(request, env);
  if (path === "/api/v1/popup-graveyard") return handlePopupTotals(request, env);
  if (path === "/api/v1/objectives") return handleObjectives(request, env);
  if (path === "/api/v1/creature") return handleCreature(request, env);
  if (path === "/api/v1/creature/feed" && request.method === "POST") return handleCreatureFeed(request, env);
  if (path === "/api/v1/alchemy/recipes") return handleAlchemyRecipes(request, env);
  if (path === "/api/v1/alchemy/record" && request.method === "POST") return handleAlchemyRecord(request, env);
  if (path === "/api/v1/submissions" && request.method === "POST") return handleSubmission(request, env);
  if (path === "/api/v1/cases") return handleCases(request, env);
  const caseMatch = path.match(/^\/api\/v1\/cases\/([^/]+)$/);
  if (caseMatch && request.method === "GET") return handleCases(request, env, cleanText(caseMatch[1], 80));
  if (caseMatch && request.method === "POST") return handleCaseConclusion(request, env, cleanText(caseMatch[1], 80));
  if (path.startsWith("/api/v1/admin")) return handleAdmin(request, env, path);
  return error(request, env, 404, "route_not_found", "Archive API route not found.");
}

export default {
  fetch: router
};

export { router };
