/**
 * Portable, dependency-free, encrypted Relationship Agent dataset backup.
 * This module contains no network calls and never reads application secrets.
 *
 * Format 1: AES-256-GCM; scrypt with random salt, random nonce, and fixed
 * cost parameters. All dataset content, including IDs and timestamps, is
 * inside the authenticated ciphertext. The unencrypted header is just crypto
 * metadata. Changes to any header field fail validation or authentication.
 */
import {
  createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync,
} from "node:crypto";

const FORMAT = "relationship-agent-encrypted-backup";
const AAD = Buffer.from("relationship-agent-encrypted-backup:v1", "utf8");
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const KDF = Object.freeze({ name: "scrypt", N: 32768, r: 8, p: 1 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

export function validateStore(document) {
  if (!document || typeof document !== "object" || Array.isArray(document) ||
      document.version !== 1 || !Array.isArray(document.relationships) ||
      ["captures", "moments", "connectionJourneys"].some(
        (name) => document[name] !== undefined && !Array.isArray(document[name])
      )) {
    throw new Error("Unsupported relationship data version or collection shape.");
  }
  for (const name of ["relationships", "captures", "moments", "connectionJourneys"]) {
    const seen = new Set();
    for (const record of document[name] ?? []) {
      if (!record || typeof record !== "object" || Array.isArray(record) ||
          !isUuid(record.id) || seen.has(record.id)) {
        throw new Error("Invalid or duplicate record in " + name + ".");
      }
      seen.add(record.id);
    }
  }
  const people = new Set(document.relationships.map((item) => item.id));
  for (const journey of document.connectionJourneys ?? []) {
    if (!isUuid(journey.relationshipId) || !people.has(journey.relationshipId)) {
      throw new Error("Connection journey references a missing relationship.");
    }
  }
  return document;
}

// Stable across Postgres JSONB and ordinary JSON object key order; array
// order is intentionally significant and is retained exactly.
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(
      (key) => JSON.stringify(key) + ":" + canonicalJson(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function documentDigest(document) {
  return createHash("sha256").update(canonicalJson(validateStore(document)), "utf8").digest("hex");
}

function strictBase64(text, expectedLength) {
  if (typeof text !== "string" || text.length === 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error("Malformed encrypted backup.");
  }
  const result = Buffer.from(text, "base64");
  if (result.toString("base64") !== text ||
      (expectedLength !== undefined && result.length !== expectedLength)) {
    throw new Error("Malformed encrypted backup.");
  }
  return result;
}

function derive(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 16) {
    throw new Error("Use a private recovery passphrase of at least 16 characters.");
  }
  return scryptSync(passphrase, salt, 32, {
    N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 128 * 1024 * 1024,
  });
}

export function encryptSnapshot({ ownerId, revision, document }, passphrase) {
  if (!isUuid(ownerId) || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Invalid source dataset identity or revision.");
  }
  const digest = documentDigest(document);
  const plaintext = Buffer.from(JSON.stringify({
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceOwnerId: ownerId,
    revision,
    documentSha256: digest,
    document,
  }), "utf8");
  if (plaintext.length > MAX_DOCUMENT_BYTES) {
    throw new Error("Relationship backup exceeds the supported size.");
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = derive(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const output = JSON.stringify({
      format: FORMAT,
      formatVersion: 1,
      kdf: { ...KDF, salt: salt.toString("base64") },
      cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
      ciphertext: encrypted.toString("base64"),
    });
    if (Buffer.byteLength(output, "utf8") > MAX_FILE_BYTES) throw new Error("Encrypted backup exceeds supported size.");
    return output;
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export function decryptSnapshot(raw, passphrase) {
  if ((typeof raw !== "string" && !Buffer.isBuffer(raw)) ||
      Buffer.byteLength(raw) > MAX_FILE_BYTES) {
    throw new Error("Invalid or oversized backup file.");
  }
  let outer;
  try { outer = JSON.parse(String(raw)); } catch { throw new Error("Invalid backup JSON."); }
  if (!outer || typeof outer !== "object" || Array.isArray(outer) ||
      outer.format !== FORMAT || outer.formatVersion !== 1 ||
      !outer.kdf || outer.kdf.name !== KDF.name ||
      outer.kdf.N !== KDF.N || outer.kdf.r !== KDF.r || outer.kdf.p !== KDF.p ||
      !outer.cipher || outer.cipher.name !== "aes-256-gcm") {
    throw new Error("Unknown or modified backup format.");
  }
  const salt = strictBase64(outer.kdf.salt, 16);
  const iv = strictBase64(outer.cipher.iv, 12);
  const tag = strictBase64(outer.cipher.tag, 16);
  const ciphertext = strictBase64(outer.ciphertext);
  const key = derive(passphrase, salt);
  let clear;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Backup authentication failed: wrong passphrase or damaged file.");
  } finally {
    key.fill(0);
  }
  try {
    if (clear.length > MAX_DOCUMENT_BYTES) throw new Error("Decrypted backup is oversized.");
    const snapshot = JSON.parse(clear.toString("utf8"));
    if (!snapshot || snapshot.formatVersion !== 1 ||
        !isUuid(snapshot.sourceOwnerId) ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
        typeof snapshot.exportedAt !== "string" ||
        !/^[a-f0-9]{64}$/.test(snapshot.documentSha256)) {
      throw new Error("Backup has an invalid dataset manifest.");
    }
    if (documentDigest(snapshot.document) !== snapshot.documentSha256) {
      throw new Error("Backup document integrity check failed.");
    }
    return snapshot;
  } finally {
    clear.fill(0);
  }
}
