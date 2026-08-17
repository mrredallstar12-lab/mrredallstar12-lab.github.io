import { randomUUID } from "node:crypto";

export function newId(prefix = "ofa") {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function jsonString(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

export function parseJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

