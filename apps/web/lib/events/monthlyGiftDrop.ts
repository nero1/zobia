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

import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { logger } from "@/lib/logger";

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
  giftItemId: string | null;
  title: string;
  availableFrom: Date;
  availableUntil: Date;
  announcedAt: Date | null;
  isActive: boolean | null;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function rowToGiftDrop(row: GiftDropRow): MonthlyGiftDrop {
  return {
    id: row.id,
    giftItemId: row.giftItemId ?? "",
    title: row.title,
    availableFrom: new Date(row.availableFrom).toISOString(),
    availableUntil: new Date(row.availableUntil).toISOString(),
    announcedAt: row.announcedAt ? new Date(row.announcedAt).toISOString() : null,
    isActive: Boolean(row.isActive),
  };
}

const giftDropColumns = {
  id: schema.monthlyGiftDrops.id,
  giftItemId: schema.monthlyGiftDrops.giftItemId,
  title: schema.monthlyGiftDrops.title,
  availableFrom: schema.monthlyGiftDrops.availableFrom,
  availableUntil: schema.monthlyGiftDrops.availableUntil,
  announcedAt: schema.monthlyGiftDrops.announcedAt,
  isActive: schema.monthlyGiftDrops.isActive,
};

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
  db: DbOrTx
): Promise<MonthlyGiftDrop | null> {
  const [row] = await db
    .select(giftDropColumns)
    .from(schema.monthlyGiftDrops)
    .where(
      and(
        eq(schema.monthlyGiftDrops.isActive, true),
        lte(schema.monthlyGiftDrops.availableFrom, sql`NOW()`),
        gt(schema.monthlyGiftDrops.availableUntil, sql`NOW()`)
      )
    )
    .orderBy(sql`${schema.monthlyGiftDrops.availableFrom} DESC`)
    .limit(1);
  return row ? rowToGiftDrop(row) : null;
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
  db: DbOrTx
): Promise<MonthlyGiftDrop | null> {
  const [row] = await db
    .select(giftDropColumns)
    .from(schema.monthlyGiftDrops)
    .where(
      and(
        eq(schema.monthlyGiftDrops.isActive, false),
        gt(schema.monthlyGiftDrops.availableFrom, sql`NOW()`),
        lte(schema.monthlyGiftDrops.availableFrom, sql`NOW() + INTERVAL '24 hours'`)
      )
    )
    .orderBy(asc(schema.monthlyGiftDrops.availableFrom))
    .limit(1);
  return row ? rowToGiftDrop(row) : null;
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
 * @param db         - Drizzle db instance or an active transaction handle.
 * @returns The newly created MonthlyGiftDrop.
 */
export async function scheduleMonthlyGiftDrop(
  giftItemId: string,
  startAt: Date,
  db: DbOrTx
): Promise<MonthlyGiftDrop> {
  const availableUntil = new Date(startAt.getTime() + 48 * 60 * 60 * 1000);

  // Look up the gift item name to use as the drop title
  const [item] = await db
    .select({ name: schema.giftItems.name })
    .from(schema.giftItems)
    .where(and(eq(schema.giftItems.id, giftItemId), eq(schema.giftItems.isRetired, false)))
    .limit(1);

  if (!item) {
    throw new Error(`Gift item ${giftItemId} not found or already retired`);
  }

  const title = `Mystery Drop: ${item.name}`;

  const [row] = await db
    .insert(schema.monthlyGiftDrops)
    .values({
      giftItemId,
      title,
      availableFrom: startAt,
      availableUntil,
      isActive: false,
    })
    .returning(giftDropColumns);

  return rowToGiftDrop(row);
}

/**
 * Retire a gift drop: close its window and mark the underlying gift item as
 * is_retired=true, is_limited_edition=true.
 *
 * Called when the 48-hour availability window closes.
 *
 * @param dropId - UUID of the monthly_gift_drops row.
 * @param db     - Drizzle db instance or an active transaction handle.
 */
export async function retireGiftDrop(
  dropId: string,
  db: DbOrTx
): Promise<void> {
  // Get the gift_item_id for this drop
  const [row] = await db
    .select({ giftItemId: schema.monthlyGiftDrops.giftItemId })
    .from(schema.monthlyGiftDrops)
    .where(eq(schema.monthlyGiftDrops.id, dropId))
    .limit(1);

  if (!row) {
    throw new Error(`Gift drop ${dropId} not found`);
  }

  const giftItemId = row.giftItemId;

  // Both UPDATEs must succeed atomically — partial failure (drop deactivated but
  // item not retired) would allow the gift item to be re-scheduled into a new drop.
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx
      .update(schema.monthlyGiftDrops)
      .set({ isActive: false })
      .where(eq(schema.monthlyGiftDrops.id, dropId));

    if (giftItemId) {
      await tx
        .update(schema.giftItems)
        .set({ isRetired: true, isActive: false, isLimitedEdition: true, updatedAt: new Date() })
        .where(eq(schema.giftItems.id, giftItemId));
    }
  });
}

/**
 * CRON handler: check if any drops need to be announced, activated, or retired.
 *
 * - Announces drops whose start time is within the next 24 hours (sets announced_at).
 * - Activates drops whose start time has arrived (sets is_active=TRUE).
 * - Retires drops whose end time has passed (calls retireGiftDrop()).
 *
 * @param db - Drizzle db instance or an active transaction handle.
 * @returns Counts of drops processed in each category.
 */
export async function processPendingGiftDrops(db: DbOrTx): Promise<{
  activated: number;
  retired: number;
  announced: number;
}> {
  let activated = 0;
  let retired = 0;
  let announced = 0;

  // 1. Announce upcoming drops (within next 24 hours, not yet announced)
  const toAnnounce = await db
    .update(schema.monthlyGiftDrops)
    .set({ announcedAt: new Date() })
    .where(
      and(
        eq(schema.monthlyGiftDrops.isActive, false),
        isNull(schema.monthlyGiftDrops.announcedAt),
        lte(schema.monthlyGiftDrops.availableFrom, sql`NOW() + INTERVAL '24 hours'`),
        gt(schema.monthlyGiftDrops.availableFrom, sql`NOW()`)
      )
    )
    .returning({
      id: schema.monthlyGiftDrops.id,
      giftItemId: schema.monthlyGiftDrops.giftItemId,
      availableFrom: schema.monthlyGiftDrops.availableFrom,
      availableUntil: schema.monthlyGiftDrops.availableUntil,
    });
  announced = toAnnounce.length;

  // Create a FOMO announcement banner for each newly-announced drop, reusing
  // the existing sitewide announcement-banner mechanism (surfaces on /gifts
  // and everywhere else banners render since there is no narrower,
  // page-specific targeting available). The banner's ends_at is pinned to
  // the drop's available_until so it disappears on its own once the drop's
  // 48-hour window (and thus the gift) is retired — no separate retire-time
  // banner cleanup is needed.
  for (const drop of toAnnounce) {
    try {
      if (!drop.giftItemId) continue;
      const [gift] = await db
        .select({ name: schema.giftItems.name, emoji: schema.giftItems.emoji })
        .from(schema.giftItems)
        .where(eq(schema.giftItems.id, drop.giftItemId))
        .limit(1);
      if (!gift) continue;

      await db.insert(schema.announcementBanners).values({
        title: `Limited-Time Gift Drop: ${gift.name}`,
        content: `⚡ ${gift.emoji} ${gift.name} is dropping soon — available for 48 hours only, then gone for good. Don't miss it!`,
        contentType: "text",
        linkUrl: "/gifts",
        isActive: true,
        targetPlans: [],
        targetRoles: [],
        displayOrder: 0,
        startsAt: new Date(),
        endsAt: drop.availableUntil,
        createdBy: "cron:monthly_gift_drop",
      });
    } catch (err) {
      logger.error({ err }, `[monthlyGiftDrop] Failed to create announcement banner for drop ${drop.id}:`);
    }
  }

  // Notify all active users about newly announced drops — paginated in batches
  // of 10,000 to avoid loading the full user table into memory (IMP-SCALE-01).
  if (toAnnounce.length > 0) {
    const BATCH_SIZE = 10_000;
    for (const drop of toAnnounce) {
      let cursorId: string | null = null;
      let batchIndex = 0;
      while (true) {
        const batchRows: { id: string }[] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            cursorId
              ? and(isNull(schema.users.deletedAt), eq(schema.users.isBanned, false), sql`${schema.users.id} > ${cursorId}`)
              : and(isNull(schema.users.deletedAt), eq(schema.users.isBanned, false))
          )
          .orderBy(asc(schema.users.id))
          .limit(BATCH_SIZE);
        if (batchRows.length === 0) break;
        const batchIds = batchRows.map((r) => r.id);
        await insertNotificationBatch(
          db,
          batchIds,
          'gift_drop_announced',
          'Monthly Gift Drop Announced!',
          'A limited-time exclusive gift is dropping soon. Check it out before it\'s gone!',
          { giftDropId: drop.id, batchIndex }
        )
          .catch((err: unknown) => {
            logger.error({ err: err }, `[monthlyGiftDrop] Failed to send notifications for drop ${drop.id} batch ${batchIndex}:`);
          });
        if (batchRows.length < BATCH_SIZE) break;
        cursorId = batchRows[batchRows.length - 1].id;
        batchIndex++;
      }
    }
  }

  // 2. Activate drops whose window has opened
  const toActivate = await db
    .update(schema.monthlyGiftDrops)
    .set({ isActive: true })
    .where(
      and(
        eq(schema.monthlyGiftDrops.isActive, false),
        lte(schema.monthlyGiftDrops.availableFrom, sql`NOW()`),
        gt(schema.monthlyGiftDrops.availableUntil, sql`NOW()`)
      )
    )
    .returning({ id: schema.monthlyGiftDrops.id });
  activated = toActivate.length;

  // 3. Retire drops whose window has closed
  const toRetire = await db
    .select({ id: schema.monthlyGiftDrops.id })
    .from(schema.monthlyGiftDrops)
    .where(and(eq(schema.monthlyGiftDrops.isActive, true), lte(schema.monthlyGiftDrops.availableUntil, sql`NOW()`)));

  for (const row of toRetire) {
    await retireGiftDrop(row.id, db);
    retired++;
  }

  return { activated, retired, announced };
}
