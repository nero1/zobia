import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Current encryption version prefix — bump to v2 when rotating keys
const CURRENT_VERSION = "v1";

const keyCache = new Map<string, Buffer>();

function getKeyForVersion(version: string): Buffer {
  if (keyCache.has(version)) return keyCache.get(version)!;
  const envVar = `KYC_ENCRYPTION_KEY_${version.toUpperCase()}`;
  const raw = process.env[envVar];
  if (!raw) throw new Error(`${envVar} env var not set`);
  const key = createHash("sha256").update(raw).digest();
  keyCache.set(version, key);
  return key;
}

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
 * Returns plaintext, or null if the value is not encrypted (legacy plaintext passthrough).
 */
export function decryptField(ciphertext: string): string | null {
  try {
    // Parse version prefix (e.g. "v1:<base64>")
    const colonIdx = ciphertext.indexOf(":");
    if (colonIdx === -1) {
      // Legacy unversioned ciphertext — try V1 key for backward compat
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
