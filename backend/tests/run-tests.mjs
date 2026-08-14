import assert from "node:assert/strict";
import {
  cleanText,
  fallbackSignal,
  isAllowedOrigin,
  normalizeOrigin,
  publicVisitorLabel,
  scrubPayload,
  validateEventPayload,
  validateVisitorId
} from "../src/index.js";

const tests = [];
function test(name, fn){tests.push({name,fn})}

test("origin normalization preserves official origins and localhost ports", () => {
  assert.equal(normalizeOrigin("https://oddfrequencyarchive.com/path"), "https://oddfrequencyarchive.com");
  assert.equal(normalizeOrigin("http://localhost:8787/api/v1/health"), "http://localhost:8787");
  assert.equal(isAllowedOrigin("https://oddfrequencyarchive.com/pages/radio.html"), true);
  assert.equal(isAllowedOrigin("https://mirror.example.com"), false);
});

test("text cleaning removes control characters and limits length", () => {
  assert.equal(cleanText("hello\u0000   archive", 20), "hello archive");
  assert.equal(cleanText("abcdef", 3), "abc");
});

test("visitor IDs are opaque random IDs, not arbitrary personal text", () => {
  assert.equal(validateVisitorId("ofa_1234567890abcdef"), true);
  assert.equal(validateVisitorId("bob@example.com"), false);
  assert.match(publicVisitorLabel("ofa_1234567890abcdef"), /^VISITOR \d{4}$/);
});

test("event validation rejects unknown event types and scrubs sensitive payload fields", () => {
  assert.equal(validateEventPayload({ type: "real_download" }).ok, false);
  const valid = validateEventPayload({
    type: "popup_close",
    visitorId: "ofa_1234567890abcdef",
    payload: { popupType: "FREE_IPOD_04", ipAddress: "127.0.0.1", note: "<b>hello</b>" }
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(scrubPayload(valid.event.payload), { popupType: "FREE_IPOD_04", note: "<b>hello</b>" });
});

test("daily fallback is deterministic per date", () => {
  const a = fallbackSignal(new Date("2026-08-13T12:00:00Z"));
  const b = fallbackSignal(new Date("2026-08-13T22:00:00Z"));
  assert.equal(a.artifact, b.artifact);
  assert.equal(a.source, "local-fallback");
});

let passed = 0;
for(const entry of tests){
  await entry.fn();
  passed += 1;
  console.log(`ok ${passed} - ${entry.name}`);
}
console.log(`${passed} backend validation tests passed`);
