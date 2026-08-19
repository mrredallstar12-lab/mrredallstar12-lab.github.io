import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(dirname(backendDir), "js", "ofa-api.js"), "utf8");

function loadBridge({ hostname, protocol = "http:", origin, storedBase = "", windowBase = "" }) {
  const values = new Map(storedBase ? [["oddApiBaseUrl", storedBase]] : []);
  const window = {
    OFA_API_BASE_URL: windowBase,
    location: { hostname, protocol, origin }
  };
  const sandbox = {
    window,
    document: { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    crypto: { getRandomValues(bytes) { return bytes.fill(1); } },
    console: { info() {}, log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    addEventListener() {}
  };
  vm.runInNewContext(source, sandbox, { filename: "ofa-api.js" });
  return { api: window.OFA, values };
}

const loopback = loadBridge({ hostname: "127.0.0.1", origin: "http://127.0.0.1:8787" });
assert.equal(loopback.api.getApiBase(), "http://127.0.0.1:8787");
assert.equal(loopback.values.has("oddApiBaseUrl"), false);

const localhost = loadBridge({ hostname: "localhost", origin: "http://localhost:8787" });
assert.equal(localhost.api.getApiBase(), "http://localhost:8787");

const publicHost = loadBridge({ hostname: "oddfrequencyarchive.com", protocol: "https:", origin: "https://oddfrequencyarchive.com" });
assert.equal(publicHost.api.getApiBase(), "");

const offline = loadBridge({ hostname: "", protocol: "file:", origin: "null" });
assert.equal(offline.api.getApiBase(), "");

const explicit = loadBridge({
  hostname: "oddfrequencyarchive.com", protocol: "https:", origin: "https://oddfrequencyarchive.com",
  windowBase: "https://api.example.invalid/"
});
assert.equal(explicit.api.getApiBase(), "https://api.example.invalid");

const stored = loadBridge({
  hostname: "oddfrequencyarchive.com", protocol: "https:", origin: "https://oddfrequencyarchive.com",
  storedBase: "https://stored.example.invalid/"
});
assert.equal(stored.api.getApiBase(), "https://stored.example.invalid");

assert.equal(loopback.api.canonicalCaseAction({ type: "case", capabilities: { investigation: true } }), "investigation");
assert.equal(loopback.api.canonicalCaseAction({ type: "case" }), "review");
assert.equal(loopback.api.canonicalCaseAction({ type: "record", capabilities: { investigation: true } }), "review");
assert.match(source, /data-investigation-start/);
assert.match(source, /data-investigation-pin/);
assert.match(source, /data-investigation-unpin/);
assert.match(source, /data-investigation-attempt/);
assert.match(source, /step\.resolved \? ""/);

const canonicalBridge = source.slice(source.indexOf("let canonicalPlayerState"), source.indexOf("function pageIsPublicNormal"));
assert.equal(canonicalBridge.includes("localStorage"), false);
assert.equal(canonicalBridge.includes("oddInventory"), false);

console.log("phase 8 frontend integration tests passed");
