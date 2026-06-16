/**
 * lib/events/monthlyGiftDrop.ts
 *
 * Monthly Mystery Gift Drop engine.
 *
 * Each month one exclusive limited gift is released for a 48-hour window only,
 * then permanently retired. It is announced 24 hours in advance with a countdown.
 *
 * Flow:
 *   1. Admin (or CRON) calls scheduleMonthlyGiftDrop() with a giftItemId + startAt.
 *   2. CRON calls processPendingGiftDrops() every run:
 *      - Announces drops whose announcement window has opened (startAt - 24h <= NOW < startAt).
 *      - Activates drops whose availability window has opened (startAt <= NOW < startAt + 48h).
 *      - Retires drops whose availability window has closed (NOW >= startAt + 48h).
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { insertNotificationBatch } from "@/lib/notifications/insert";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonthlyGiftDrop {
  id: string;
  giftItemId: string;
  title: string;
  availableFrom: string;
  availableUntil: string;
  announcedAt: string | null;
  isActive: boolean;
}

interface GiftDropRow {
  id: string;
  gift_item_id: string;
  title: string;
  available_from: string;
  available_until: string;
  announced_at: string | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function rowToGiftDrop(row: GiftDropRow): MonthlyGiftDrop {
  return {
    id: row.id,
    giftItemId: row.gift_item_id,
    title: row.title,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    announcedAt: row.announced_at,
    isActive: row.is_active,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current active drop (if within the 48-hour window).
 *
 * A drop is "active" when:
 *   - is_active = TRUE
 *   - available_from <= NOW()
 *   - available_until > NOW()
 *
 * @returns The active MonthlyGiftDrop, or null if none.
 */
export async function getActiveGiftDrop(
  db: DatabaseAdapter
): Promise<MonthlyGiftDrop | null> {
  const { rows } = await db.query<GiftDropRow>(
    `SELECT id, gift_item_id, title, available_from, available_until, announced_at, is_active
     FROM monthly_gift_drops
     WHERE is_active = TRUE
       AND available_from <= NOW()
       AND available_until > NOW()
     ORDER BY available_from DESC
     LIMIT 1`
  );
  return rows[0] ? rowToGiftDrop(rows[0]) : null;
}

/**
 * Get an upcoming drop within the 24-hour announcement window (not yet active).
 *
 * A drop is "upcoming" when:
 *   - is_active = FALSE
 *   - available_from BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
 *
 * @returns The upcoming MonthlyGiftDrop, or null if none.
 */
export async function getUpcomingGiftDrop(
  db: DatabaseAdapter
): Promise<MonthlyGiftDrop | null> {
  const { rows } = await db.query<GiftDropRow>(
    `SELECT id, gift_item_id, title, available_from, available_until, announced_at, is_active
     FROM monthly_gift_drops
     WHERE is_active = FALSE
       AND available_from > NOW()
       AND available_from <= NOW() + INTERVAL '24 hours'
     ORDER BY available_from ASC
     LIMIT 1`
  );
  return rows[0] ? rowToGiftDrop(rows[0]) : null;
}

/**
 * Schedule the next monthly gift drop.
 *
 * Creates a drop starting at `startAt`, lasting exactly 48 hours.
 * The title is derived from the gift item's name.
 * Called by admin or CRON.
 *
 * @param giftItemId - UUID of the gift_items row to release.
 * @param startAt    - When the 48-hour window begins.
 * @param db         - Database adapter.
 * @returns The newly created MonthlyGiftDrop.
 */
export async function scheduleMonthlyGiftDrop(
  giftItemId: string,
  startAt: Date,
  db: DatabaseAdapter
): Promise<MonthlyGiftDrop> {
  const availableUntil = new Date(startAt.getTime() + 48 * 60 * 60 * 1000);

  // Look up the gift item name to use as the drop title
  const { rows: itemRows } = await db.query<{ name: string }>(
    `SELECT name FROM gift_items WHERE id = $1 AND is_retired = FALSE LIMIT 1`,
    [giftItemId]
  );

  if (!itemRows[0]) {
    throw new Error(`Gift item ${giftItemId} not found or already retired`);
  }

  const title = `Mystery Drop: ${itemRows[0].name}`;

  const { rows } = await db.query<GiftDropRow>(
    `INSERT INTO monthly_gift_drops
       (gift_item_id, title, available_from, available_until, is_active, created_at)
     VALUES ($1, $2, $3, $4, FALSE, NOW())
     RETURNING id, gift_item_id, title, available_from, available_until, announced_at, is_active`,
    [giftItemId, title, startAt.toISOString(), availableUntil.toISOString()]
  );

  return rowToGiftDrop(rows[0]);
}

/**
 * Retire a gift drop: close its window and mark the underlying gift item as
 * is_retired=true, is_limited_edition=true.
 *
 * Called when the 48-hour availability window closes.
 *
 * @param dropId - UUID of the monthly_gift_drops row.
 * @param db     - Database adapter.
 */
export async function retireGiftDrop(
  dropId: string,
  db: DatabaseAdapter
): Promise<void> {
  // Get the gift_item_id for this drop
  const { rows } = await db.query<{ gift_item_id: string }>(
    `SELECT gift_item_id FROM monthly_gift_drops WHERE id = $1`,
    [dropId]
  );

  if (!rows[0]) {
    throw new Error(`Gift drop ${dropId} not found`);
  }

  const giftItemId = rows[0].gift_item_id;

  // Deactivate the drop record
  await db.query(
    `UPDATE monthly_gift_drops
     SET is_active = FALSE
     WHERE id = $1`,
    [dropId]
  );

  // Permanently retire the gift item
  await db.query(
    `UPDATE gift_items
     SET is_retired = TRUE,
         is_limited_edition = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [giftItemId]
  );
}

/**
 * CRON handler: check if any drops need to be announced, activated, or retired.
 *
 * - Announces drops whose start time is within the next 24 hours (sets announced_at).
 * - Activates drops whose start time has arrived (sets is_active=TRUE).
 * - Retires drops whose end time has passed (calls retireGiftDrop()).
 *
 * @param db - Database adapter.
 * @returns Counts of drops processed in each category.
 */
export async function processPendingGiftDrops(db: DatabaseAdapter): Promise<{
  activated: number;
  retired: number;
  announced: number;
}> {
  let activated = 0;
  let retired = 0;
  let announced = 0;

  // 1. Announce upcoming drops (within next 24 hours, not yet announced)
  const { rows: toAnnounce } = await db.query<{ id: string }>(
    `UPDATE monthly_gift_drops
     SET announced_at = NOW()
     WHERE is_active = FALSE
       AND announced_at IS NULL
       AND available_from <= NOW() + INTERVAL '24 hours'
       AND available_from > NOW()
     RETURNING id`
  );
  announced = toAnnounce.length;

  // Notify all active users about newly announced drops — paginated in batches
  // of 10,000 to avoid loading the full user table into memory (IMP-SCALE-01).
  if (toAnnounce.length > 0) {
    const BATCH_SIZE = 10_000;
    for (const drop of toAnnounce) {
      let cursorId: string | null = null;
      let batchIndex = 0;
      while (true) {
        const batchResult = await db.query<{ id: string }>(
          `SELECT id FROM users
           WHERE deleted_at IS NULL
             AND COALESCE(is_banned, false) = false
             ${cursorId ? `AND id > $1` : ''}
           ORDER BY id ASC
           LIMIT ${cursorId ? '$2' : '$1'}`,
          cursorId ? [cursorId, BATCH_SIZE] : [BATCH_SIZE]
        );
        const batchRows: { id: string }[] = batchResult.rows;
        if (batchRows.length === 0) break;
        const batchIds = batchRows.map((r) => r.id);
        await insertNotificationBatch(db, batchIds, 'gift_drop_announced', { giftDropId: drop.id, batchIndex })
          .catch((err: unknown) =>
            console.error(`[monthlyGiftDrop] Failed to send notifications for drop ${drop.id} batch ${batchIndex}:`, err)
          );
        if (batchRows.length < BATCH_SIZE) break;
        cursorId = batchRows[batchRows.length - 1].id;
        batchIndex++;
      }
    }
  }

  // 2. Activate drops whose window has opened
  const { rows: toActivate } = await db.query<{ id: string }>(
    `UPDATE monthly_gift_drops
     SET is_active = TRUE
     WHERE is_active = FALSE
       AND available_from <= NOW()
       AND available_until > NOW()
     RETURNING id`
  );
  activated = toActivate.length;

  // 3. Retire drops whose window has closed
  const { rows: toRetire } = await db.query<{ id: string }>(
    `SELECT id FROM monthly_gift_drops
     WHERE is_active = TRUE
       AND available_until <= NOW()`
  );

  for (const row of toRetire) {
    await retireGiftDrop(row.id, db);
    retired++;
  }

  return { activated, retired, announced };
}
