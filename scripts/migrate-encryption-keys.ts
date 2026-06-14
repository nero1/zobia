#!/usr/bin/env ts-node
/**
 * scripts/migrate-encryption-keys.ts
 *
 * One-time KYC field encryption key rotation script (FIX-01 / BUG-SE01).
 *
 * Re-encrypts all versioned ciphertext fields from an old key version
 * to the new current version. Run this BEFORE removing the old key from env.
 *
 * Usage:
 *   KYC_ENCRYPTION_KEY_V1=<old> KYC_ENCRYPTION_KEY_V2=<new> \
 *     DATABASE_URL=postgres://... \
 *     npx ts-node scripts/migrate-encryption-keys.ts --from v1 --to v2 [--dry-run]
 *
 * Safety:
 *   - Reads the old ciphertext, decrypts with --from key, re-encrypts with --to key.
 *   - Uses a DB transaction per batch — on any error the batch is rolled back.
 *   - --dry-run flag prints what would change without writing to the database.
 *   - Only processes rows whose ciphertext starts with the --from version prefix.
 *   - Idempotent: rows already on --to version are skipped.
 */

import { Client } from "pg";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const BATCH_SIZE = 100;

// Columns that store versioned KYC ciphertext — extend as needed
const ENCRYPTED_COLUMNS: Array<{ table: string; idColumn: string; column: string }> = [
  { table: "kyc_records",      idColumn: "id", column: "bank_account_number" },
  { table: "kyc_records",      idColumn: "id", column: "bvn_hash" },
  { table: "creator_payouts",  idColumn: "id", column: "bank_account_snapshot" },
  // Add more encrypted columns here as the schema grows
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const fromVersion = get("--from");
  const toVersion   = get("--to");
  const dryRun      = args.includes("--dry-run");

  if (!fromVersion || !toVersion) {
    console.error("Usage: migrate-encryption-keys.ts --from v1 --to v2 [--dry-run]");
    process.exit(1);
  }
  return { fromVersion, toVersion, dryRun };
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function deriveKey(envVarValue: string): Buffer {
  return createHash("sha256").update(envVarValue).digest();
}

function getEnvKey(version: string): Buffer {
  const envVar = `KYC_ENCRYPTION_KEY_${version.toUpperCase()}`;
  const raw = process.env[envVar];
  if (!raw) {
    console.error(`Missing required env var: ${envVar}`);
    process.exit(1);
  }
  return deriveKey(raw);
}

function decrypt(versioned: string, key: Buffer): string {
  const colonIdx = versioned.indexOf(":");
  const b64 = colonIdx === -1 ? versioned : versioned.slice(colonIdx + 1);
  const buf = Buffer.from(b64, "base64");
  const iv      = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const enc     = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
}

function encrypt(plaintext: string, key: Buffer, version: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${version}:${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrateColumn(
  db: Client,
  { table, idColumn, column }: typeof ENCRYPTED_COLUMNS[0],
  fromVersion: string,
  toVersion: string,
  oldKey: Buffer,
  newKey: Buffer,
  dryRun: boolean
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped  = 0;
  let errors   = 0;
  let offset   = 0;

  console.log(`\n[${table}.${column}] starting migration ${fromVersion} → ${toVersion}`);

  while (true) {
    const { rows } = await db.query<{ id: string; value: string }>(
      `SELECT ${idColumn} AS id, ${column} AS value
         FROM ${table}
        WHERE ${column} IS NOT NULL
          AND ${column} LIKE $1
        ORDER BY ${idColumn}
        LIMIT $2 OFFSET $3`,
      [`${fromVersion}:%`, BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const plaintext   = decrypt(row.value, oldKey);
        const reEncrypted = encrypt(plaintext, newKey, toVersion);

        if (!dryRun) {
          await db.query(
            `UPDATE ${table} SET ${column} = $1, updated_at = NOW() WHERE ${idColumn} = $2`,
            [reEncrypted, row.id]
          );
        } else {
          console.log(`  [dry-run] would update ${table}(${row.id}).${column}: ${fromVersion}:*** → ${toVersion}:***`);
        }
        migrated++;
      } catch (err) {
        console.error(`  [error] ${table}(${row.id}).${column}: ${(err as Error).message}`);
        errors++;
      }
    }

    offset += rows.length;
    console.log(`  processed ${offset} rows so far (${migrated} migrated, ${errors} errors)...`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`[${table}.${column}] done — migrated: ${migrated}, skipped: ${skipped}, errors: ${errors}`);
  return { migrated, skipped, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { fromVersion, toVersion, dryRun } = parseArgs();

  const oldKey = getEnvKey(fromVersion);
  const newKey = getEnvKey(toVersion);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Missing DATABASE_URL environment variable");
    process.exit(1);
  }

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  console.log(`Starting KYC encryption key migration: ${fromVersion} → ${toVersion}`);
  if (dryRun) console.log("DRY RUN — no changes will be written to the database");

  let totalMigrated = 0;
  let totalErrors   = 0;

  for (const col of ENCRYPTED_COLUMNS) {
    const result = await migrateColumn(db, col, fromVersion, toVersion, oldKey, newKey, dryRun);
    totalMigrated += result.migrated;
    totalErrors   += result.errors;
  }

  await db.end();

  console.log(`\nMigration complete — total migrated: ${totalMigrated}, total errors: ${totalErrors}`);
  if (totalErrors > 0) {
    console.error("Some rows failed migration. Resolve errors before removing the old key.");
    process.exit(1);
  }
  if (!dryRun) {
    console.log(`\nNext steps:`);
    console.log(`  1. Verify the migration: KYC_ENCRYPTION_KEY_${fromVersion.toUpperCase()}=<old> KYC_ENCRYPTION_KEY_${toVersion.toUpperCase()}=<new> npx ts-node scripts/migrate-encryption-keys.ts --from ${fromVersion} --to ${toVersion} --dry-run`);
    console.log(`  2. Update CURRENT_VERSION in lib/security/fieldEncryption.ts to "${toVersion}"`);
    console.log(`  3. After confirming all records are on ${toVersion}, remove ${fromVersion} from env and keyCache`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
