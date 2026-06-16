/**
 * lib/security/migrateEncryption.ts
 *
 * One-time migration script: re-encrypts all v1 (SHA-256 KDF) field-encrypted
 * values in the database to v2 (scrypt KDF).
 *
 * Tables and columns covered:
 *   - users.totp_secret
 *   - creator_bank_accounts.account_number (encrypted PII)
 *   - creator_wallet_addresses.address (encrypted PII)
 *
 * Run via: npx tsx apps/web/lib/security/migrateEncryption.ts
 * Idempotent — v2 values are detected and skipped automatically.
 */

import { db } from "@/lib/db";
import { migrateFieldEncryption } from "@/lib/security/fieldEncryption";

const BATCH_SIZE = 500;

async function migrateColumn(
  table: string,
  column: string,
  idCol = "id"
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;

  console.log(`[migrate] Starting ${table}.${column} ...`);

  while (true) {
    const { rows } = await db.query<{ id: string; val: string }>(
      `SELECT ${idCol} AS id, ${column} AS val
       FROM ${table}
       WHERE ${column} IS NOT NULL
         ${lastId ? `AND ${idCol} > $1` : ""}
       ORDER BY ${idCol} ASC
       LIMIT ${lastId ? "$2" : "$1"}`,
      lastId ? [lastId, BATCH_SIZE] : [BATCH_SIZE]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const newVal = migrateFieldEncryption(row.val);
        if (newVal === null) {
          console.warn(`[migrate] Decryption failed for ${table}.${column} id=${row.id} — skipping`);
          errors++;
        } else if (newVal === row.val) {
          // Already at current version
          skipped++;
        } else {
          await db.query(
            `UPDATE ${table} SET ${column} = $1, updated_at = NOW() WHERE ${idCol} = $2`,
            [newVal, row.id]
          );
          migrated++;
        }
      } catch (err) {
        console.error(`[migrate] Error migrating ${table}.${column} id=${row.id}:`, err);
        errors++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
    lastId = rows[rows.length - 1].id;
  }

  console.log(`[migrate] ${table}.${column}: migrated=${migrated} skipped=${skipped} errors=${errors}`);
  return { migrated, skipped, errors };
}

export async function runEncryptionMigration(): Promise<{
  totalMigrated: number;
  totalSkipped: number;
  totalErrors: number;
}> {
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  const targets: Array<{ table: string; column: string; idCol?: string }> = [
    { table: "users", column: "totp_secret" },
    { table: "creator_bank_accounts", column: "account_number" },
    { table: "creator_wallet_addresses", column: "address" },
  ];

  for (const target of targets) {
    const result = await migrateColumn(target.table, target.column, target.idCol);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  console.log(`[migrate] Done — total migrated=${totalMigrated} skipped=${totalSkipped} errors=${totalErrors}`);
  return { totalMigrated, totalSkipped, totalErrors };
}

// Allow running directly
if (require.main === module) {
  runEncryptionMigration()
    .then((result) => {
      console.log("[migrate] Complete:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[migrate] Fatal:", err);
      process.exit(1);
    });
}
