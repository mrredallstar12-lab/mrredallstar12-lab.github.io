import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function digestSensitiveValue(value, pepper = "") {
  return createHash("sha256").update(`${pepper}:${String(value).trim().toLowerCase()}`).digest("hex");
}

function keyFromBase64(base64) {
  const key = Buffer.from(String(base64 || ""), "base64");
  if (key.length !== 32) throw new Error("field_encryption_key_required");
  return key;
}

export function encryptSensitiveValue(value, keyBase64, keyId = "env:v1") {
  const key = keyFromBase64(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${keyId}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSensitiveValue(payload, keyBase64) {
  const key = keyFromBase64(keyBase64);
  const [, ivText, tagText, ciphertextText] = String(payload).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

