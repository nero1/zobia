import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Bump CURRENT_VERSION to "v2" when rotating to KDF-derived keys.
// v1 (SHA-256) remains for decryption of existing ciphertext only.
const CURRENT_VERSION = "v2";

// Per-version salts — fixed constants that bind the KDF output to this key version.
// Changing these invalidates all existing ciphertext for that version.
const VERSION_SALTS: Record<string, Buffer> = {
  v1: Buffer.from("zobia-field-enc-v1"),
  v2: Buffer.from("zobia-field-enc-v2"),
};

const keyCache = new Map<string, Buffer>();

function getKeyForVersion(version: string): Buffer {
  if (keyCache.has(version)) return keyCache.get(version)!;
  const envVar = `KYC_ENCRYPTION_KEY_${version.toUpperCase()}`;
  const raw = process.env[envVar];
  if (!raw) throw new Error(`${envVar} env var not set`);

  let key: Buffer;
  if (version === "v1") {
    // BUG-06 legacy: v1 used bare SHA-256 — kept for decryption of existing ciphertext only
    key = createHash("sha256").update(raw).digest();
  } else {
    // v2+: use scrypt KDF (N=16384, r=8, p=1) — secure key derivation with iteration cost
    const salt = VERSION_SALTS[version] ?? Buffer.from(`zobia-field-enc-${version}`);
    key = scryptSync(raw, salt, 32, { N: 16384, r: 8, p: 1 });
  }

  keyCache.set(version, key);
  return key;
}

// BUG-L10: Warm up the scrypt KDF at module load time (runs once per serverless
// instance cold start) rather than on the first real encrypt/decrypt call.
// This amortises the ~100 ms blocking cost at startup rather than adding it to
// the first user-facing request that touches an encrypted field.
// Errors are silenced here — missing env vars will surface at call time.
try { getKeyForVersion(CURRENT_VERSION); } catch { /* env var may not be set yet */ }

/**
 * Encrypt a plaintext string for at-rest storage.
 * Returns: "<version>:" + base64(iv + authTag + ciphertext)
 */
export function encryptField(plaintext: string): string {
  const key = getKeyForVersion(CURRENT_VERSION);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CURRENT_VERSION}:${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`;
}

/**
 * Decrypt a field encrypted by encryptField.
 * Reads the version prefix to select the correct key, enabling key rotation.
 * Returns plaintext, or null if decryption fails.
 */
export function decryptField(ciphertext: string): string | null {
  try {
    const colonIdx = ciphertext.indexOf(":");
    if (colonIdx === -1) {
      return decryptRaw(ciphertext, "v1");
    }
    const version = ciphertext.slice(0, colonIdx);
    const payload = ciphertext.slice(colonIdx + 1);
    return decryptRaw(payload, version);
  } catch (err) {
    console.error("[fieldEncryption] decryptField failed:", (err as Error).message);
    return null;
  }
}

/**
 * Re-encrypt a v1 ciphertext string with the current version (v2).
 *
 * Usage: call this in a migration script for each encrypted column row.
 * - If the value is already v2 (or higher), it is returned unchanged.
 * - If decryption fails (corrupt data), returns null so the caller can skip/log.
 *
 * @param ciphertext - Existing encrypted value from the database
 * @returns New ciphertext in CURRENT_VERSION format, or null on failure
 */
export function migrateFieldEncryption(ciphertext: string): string | null {
  const colonIdx = ciphertext.indexOf(":");
  const version = colonIdx !== -1 ? ciphertext.slice(0, colonIdx) : "v1";
  if (version === CURRENT_VERSION) return ciphertext; // already up-to-date
  const plaintext = decryptField(ciphertext);
  if (plaintext === null) return null;
  return encryptField(plaintext);
}

function decryptRaw(base64Payload: string, version: string): string | null {
  try {
    const key = getKeyForVersion(version);
    const buf = Buffer.from(base64Payload, "base64");
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
  } catch (err) {
    console.error(`[fieldEncryption] decryptRaw(${version}) failed:`, (err as Error).message);
    return null;
  }
}
