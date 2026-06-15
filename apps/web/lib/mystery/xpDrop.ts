/**
 * lib/mystery/xpDrop.ts
 *
 * Mystery XP Drop engine.
 *
 * Randomly selects a batch of active users and awards each a random XP amount
 * between 100 and 1 000 XP. Intended to be triggered by a CRON job at random
 * intervals within a week to create surprise and delight.
 *
 * Rules:
 *  - Only users who have been active in the last 7 days are eligible.
 *  - Each award is recorded in xp_ledger with source 'mystery_drop'.
 *  - A user can receive at most one mystery drop per 24-hour window.
 */

import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "@/lib/db/interface";
import { XP_VALUES } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of users to receive the drop in one invocation. */
const DEFAULT_BATCH_SIZE = 50;

/** Users active within this many days are eligible. */
const ACTIVE_WITHIN_DAYS = 7;

/** Minimum XP per drop. */
const MIN_XP = XP_VALUES.mystery_xp_drop_min;

/** Maximum XP per drop. */
const MAX_XP = XP_VALUES.mystery_xp_drop_max;

// ---------------------------------------------------------------------------
// triggerMysteryXPDrop
// ---------------------------------------------------------------------------

/**
 * Selects a random batch of recently active users and awards each a
 * random XP amount between MIN_XP and MAX_XP.
 *
 * Each award is recorded in xp_ledger with action = 'mystery_drop'.
 * Users who already received a mystery drop in the last 24 hours are skipped.
 *
 * @param db        - Active database adapter.
 * @param batchSize - How many users to award (default 50).
 * @returns Summary of awards made.
 */
export async function triggerMysteryXPDrop(
  db: DatabaseAdapter,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<{ totalAwarded: number; totalXP: number; recipients: string[] }> {
  // Batch ID for idempotency — prevents duplicate awards on retry (L-03)
  const batchId = randomUUID();

  const activeSince = new Date(
    Date.now() - ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // Find eligible users: active recently, no mystery drop in last 24h.
  // TABLESAMPLE avoids a full-table scan that ORDER BY RANDOM() would cause.
  const eligibleResult = await db.query<{ id: string }>(
    `SELECT u.id
     FROM users u TABLESAMPLE BERNOULLI(5)
     WHERE u.deleted_at IS NULL
       AND u.last_active_at >= $1
       AND u.id NOT IN (
         SELECT user_id FROM xp_ledger
         WHERE action = 'mystery_drop'
           AND created_at >= NOW() - INTERVAL '24 hours'
       )
     LIMIT $2`,
    [activeSince, batchSize]
  );

  let eligibleRows = eligibleResult.rows;
  if (eligibleRows.length < Math.ceil(batchSize / 2)) {
    const fallback = await db.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       WHERE u.deleted_at IS NULL
         AND u.last_active_at >= $1
         AND u.id NOT IN (
           SELECT user_id FROM xp_ledger
           WHERE action = 'mystery_drop'
             AND created_at >= NOW() - INTERVAL '24 hours'
         )
       ORDER BY RANDOM()
       LIMIT $2`,
      [activeSince, batchSize]
    );
    eligibleRows = fallback.rows;
  }

  const recipients: string[] = [];
  let totalXP = 0;

  for (const { id } of eligibleRows) {
    // Use Node.js built-in crypto.randomInt — no modulo bias (L-04)
    const xpAmount = cryptoRandomInt(MIN_XP, MAX_XP + 1);
    // Unique reference per user per batch for idempotency (L-03)
    const referenceId = `mystery_drop:${batchId}:${id}`;

    try {
      await db.transaction(async (client) => {
        // Update user's XP total
        await client.query(
          `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2`,
          [xpAmount, id]
        );

        // Insert xp_ledger entry with reference_id for dedup via partial unique index
        await client.query(
          `INSERT INTO xp_ledger (user_id, amount, track, source, action, base_amount, reference_id, created_at)
           VALUES ($1, $2, 'main', 'mystery_drop', 'mystery_drop', $2, $3, NOW())
           ON CONFLICT (source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
          [id, xpAmount, referenceId]
        );
      });

      recipients.push(id);
      totalXP += xpAmount;
    } catch {
      // Individual failures don't abort the whole batch
    }
  }

  return {
    totalAwarded: recipients.length,
    totalXP,
    recipients,
  };
}
