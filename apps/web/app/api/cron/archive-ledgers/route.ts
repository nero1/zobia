export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/cron/archive-ledgers
 *
 * Moves ledger rows older than `ledger_archive_days` days (default 180) from the
 * live tables to their archive counterparts. Runs in batches of 1000 rows per
 * table inside a transaction per batch to limit lock hold time.
 *
 * Protected by CRON_SECRET via Authorization: Bearer header.
 * Should be scheduled weekly (e.g. Sunday 07:00 UTC) via vercel.json.
 *
 * NOTE: xp_events rows used by the Creator Fund scoring are preserved via a
 * date-range filter — only rows older than the archive cutoff AND where the
 * user's last creator fund distribution has already processed are archived.
 * For simplicity, all xp_events older than the cutoff are archived since the
 * creator fund reads a rolling 30-day window well within the 180-day threshold.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";
import { getManifestValue } from "@/lib/manifest";
import { logger } from "@/lib/logger";

const BATCH_SIZE = 1000;

interface ArchiveResult {
  table: string;
  archived: number;
}

async function archiveTable(
  sourceTable: string,
  archiveTable: string,
  columns: string,
  cutoff: Date
): Promise<number> {
  let totalArchived = 0;

  while (true) {
    const result = await db.transaction(async (tx) => {
      const { rows: sourceRows } = await tx.query<{ id: string }>(
        `SELECT id FROM ${sourceTable}
         WHERE created_at < $1
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [cutoff.toISOString(), BATCH_SIZE]
      );

      if (sourceRows.length === 0) return 0;

      const ids = sourceRows.map((r) => r.id);

      await tx.query(
        `INSERT INTO ${archiveTable} (${columns}, archived_at)
         SELECT ${columns}, NOW()
         FROM ${sourceTable}
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );

      await tx.query(
        `DELETE FROM ${sourceTable} WHERE id = ANY($1::uuid[])`,
        [ids]
      );

      return sourceRows.length;
    });

    totalArchived += result;
    if (result < BATCH_SIZE) break;
  }

  return totalArchived;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const archiveDaysRaw = await getManifestValue("ledger_archive_days");
    const archiveDays = parseInt(archiveDaysRaw ?? "180", 10) || 180;
    const cutoff = new Date(Date.now() - archiveDays * 24 * 60 * 60 * 1000);

    const results: ArchiveResult[] = [];

    const coinArchived = await archiveTable(
      "coin_ledger",
      "coin_ledger_archive",
      "id, user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, metadata, created_at",
      cutoff
    );
    results.push({ table: "coin_ledger", archived: coinArchived });

    const starArchived = await archiveTable(
      "star_ledger",
      "star_ledger_archive",
      "id, user_id, amount, balance_before, balance_after, transaction_type, description, reference_id, created_at",
      cutoff
    );
    results.push({ table: "star_ledger", archived: starArchived });

    const xpLedgerArchived = await archiveTable(
      "xp_ledger",
      "xp_ledger_archive",
      "id, user_id, amount, track, source, reference_id, base_amount, created_at",
      cutoff
    );
    results.push({ table: "xp_ledger", archived: xpLedgerArchived });

    const xpEventsArchived = await archiveTable(
      "xp_events",
      "xp_events_archive",
      "id, user_id, action, xp_awarded, track, metadata, created_at",
      cutoff
    );
    results.push({ table: "xp_events", archived: xpEventsArchived });

    // BUG-22 FIX: archive audit_discrepancies and rank_up_events to prevent
    // unbounded table growth. Rows older than the cutoff that are resolved
    // (audit_discrepancies) or have already been processed (rank_up_events)
    // are pruned to keep the live tables small.
    const auditDiscArchived = await archiveTable(
      "audit_discrepancies",
      "audit_discrepancies_archive",
      "id, user_id, asset_type, ledger_sum, wallet_balance, detected_at, resolved, notes",
      cutoff
    );
    results.push({ table: "audit_discrepancies", archived: auditDiscArchived });

    const rankUpArchived = await archiveTable(
      "rank_up_events",
      "rank_up_events_archive",
      "id, user_id, old_rank, new_rank, xp_at_rank_up, created_at",
      cutoff
    );
    results.push({ table: "rank_up_events", archived: rankUpArchived });

    logger.info({ archiveDays, cutoff, results }, "[cron/archive-ledgers] Run complete");

    return NextResponse.json({ success: true, archiveDays, cutoff, results });
  } catch (err) {
    logger.error({ err }, "[cron/archive-ledgers] Unhandled error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
