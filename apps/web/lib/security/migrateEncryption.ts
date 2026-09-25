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

import { asc, isNotNull, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
import { migrateFieldEncryption } from "@/lib/security/fieldEncryption";
import { logger } from "@/lib/logger";

const BATCH_SIZE = 500;

interface MigrateTarget {
  table: typeof schema.users | typeof schema.creatorBankAccounts | typeof schema.creatorWalletAddresses;
  column: AnyPgColumn;
  /** camelCase JS property key on `table` corresponding to `column` (for `.set()`). */
  fieldKey: string;
  idCol: AnyPgColumn;
  tableName: string;
  columnName: string;
}

async function migrateColumn(target: MigrateTarget): Promise<{ migrated: number; skipped: number; errors: number }> {
  const { table, column, fieldKey, idCol, tableName, columnName } = target;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;

  logger.info(`[migrate] Starting ${tableName}.${columnName} ...`);

  const db = await getDb();

  while (true) {
    const rows: { id: string; val: string | null }[] = await db
      .select({ id: idCol, val: column })
      .from(table as never)
      .where(lastId ? sql`${column} IS NOT NULL AND ${idCol} > ${lastId}` : isNotNull(column))
      .orderBy(asc(idCol))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.val === null) continue;
      try {
        const newVal = migrateFieldEncryption(row.val);
        if (newVal === null) {
          logger.warn(`[migrate] Decryption failed for ${tableName}.${columnName} id=${row.id} — skipping`);
          errors++;
        } else if (newVal === row.val) {
          // Already at current version
          skipped++;
        } else {
          await db
            .update(table as never)
            .set({ [fieldKey]: newVal, updatedAt: sql`NOW()` } as never)
            .where(eq(idCol, row.id));
          migrated++;
        }
      } catch (err) {
        logger.error({ err: err }, `[migrate] Error migrating ${tableName}.${columnName} id=${row.id}:`);
        errors++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
    lastId = rows[rows.length - 1].id;
  }

  logger.info(`[migrate] ${tableName}.${columnName}: migrated=${migrated} skipped=${skipped} errors=${errors}`);
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

  const targets: MigrateTarget[] = [
    {
      table: schema.users,
      column: schema.users.totpSecret,
      fieldKey: "totpSecret",
      idCol: schema.users.id,
      tableName: "users",
      columnName: "totp_secret",
    },
    {
      table: schema.creatorBankAccounts,
      column: schema.creatorBankAccounts.accountNumber,
      fieldKey: "accountNumber",
      idCol: schema.creatorBankAccounts.id,
      tableName: "creator_bank_accounts",
      columnName: "account_number",
    },
    {
      table: schema.creatorWalletAddresses,
      column: schema.creatorWalletAddresses.address,
      fieldKey: "address",
      idCol: schema.creatorWalletAddresses.id,
      tableName: "creator_wallet_addresses",
      columnName: "address",
    },
  ];

  for (const target of targets) {
    const result = await migrateColumn(target);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  logger.info(`[migrate] Done — total migrated=${totalMigrated} skipped=${totalSkipped} errors=${totalErrors}`);
  return { totalMigrated, totalSkipped, totalErrors };
}

// Allow running directly
if (require.main === module) {
  runEncryptionMigration()
    .then((result) => {
      logger.info({ err: result }, "[migrate] Complete:");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err }, "[migrate] Fatal:");
      process.exit(1);
    });
}
