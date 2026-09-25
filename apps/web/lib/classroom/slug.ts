/**
 * lib/classroom/slug.ts
 *
 * Creator-chosen slugs for classrooms (/c/<slug>) and the governed slug
 * change pipeline. Mirrors lib/username/service.ts changeUsername() step for
 * step, inside ONE transaction:
 *
 *   1. lock the classroom row, re-check ownership + the slug-change policy's
 *      cooldown/eligibility (never trust the quote the client saw);
 *   2. re-check availability of the new slug (race-safe, under the lock);
 *   3. charge Credits through the existing ledger primitive (debitCoins) when
 *      the policy says this change isn't free;
 *   4. update rooms.slug;
 *   5. record history (classroom_slug_history) and the 301 redirect
 *      (slug_redirects, via lib/slug.ts recordSlugRedirect).
 *
 * The policy itself (free changes, Credit cost, cooldown, or fully free) is
 * creator-configured per classroom — see lib/classroom/settings.ts.
 */

import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { isValidSlug, looksLikeUuid, slugify, MAX_SLUG_LENGTH } from "@zobia/shared/utils";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { debitCoins } from "@/lib/economy/coins";
import { generateUniqueSlug } from "@/lib/slug";
import { parseClassroomSettings, type SlugPolicy } from "@/lib/classroom/settings";

export const MIN_SLUG_LENGTH = 3;

/**
 * Paths under /c/ that must never be claimable as a classroom slug (reserved
 * for future sub-routes / to avoid confusing URLs).
 */
const RESERVED_SLUGS = new Set(["new", "edit", "settings", "studio", "admin", "api", "by", "mine", "directory", "search"]);

export type SlugUnavailableReason = "invalid" | "too_short" | "reserved" | "taken" | "retired";

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason: SlugUnavailableReason | null;
}

/** Normalise user input the same way names are slugified (lowercase, hyphens). */
export function normaliseSlugInput(input: string): string {
  return slugify(input);
}

/** Syntactic checks that need no database. */
export function validateSlugShape(slug: string): SlugUnavailableReason | null {
  if (!slug || !isValidSlug(slug) || slug.length > MAX_SLUG_LENGTH) return "invalid";
  if (slug.length < MIN_SLUG_LENGTH) return "too_short";
  if (RESERVED_SLUGS.has(slug) || looksLikeUuid(slug)) return "reserved";
  return null;
}

/**
 * Is `slug` free for `roomId` (null = a classroom that doesn't exist yet)?
 * Rejects slugs held by another live room and retired slugs that still
 * 301-redirect to a *different* room (so old links never silently change
 * target). A room may reclaim its own retired slug.
 */
export async function checkSlugAvailability(
  rawSlug: string,
  roomId: string | null,
  client?: DbOrTx
): Promise<SlugAvailability> {
  const slug = normaliseSlugInput(rawSlug);
  const shape = validateSlugShape(slug);
  if (shape) return { slug, available: false, reason: shape };

  const orm = client ?? (await getDb());
  const { rows } = await orm.execute<{ taken: boolean; retired_for_other: boolean }>(sql`
    SELECT
       EXISTS (SELECT 1 FROM rooms WHERE slug = ${slug} AND deleted_at IS NULL
                 AND (${roomId}::uuid IS NULL OR id <> ${roomId}::uuid)) AS taken,
       EXISTS (SELECT 1 FROM slug_redirects WHERE entity_type = 'room' AND old_slug = ${slug}
                 AND (${roomId}::uuid IS NULL OR entity_id <> ${roomId}::uuid)) AS retired_for_other
  `);
  if (rows[0]?.taken) return { slug, available: false, reason: "taken" };
  if (rows[0]?.retired_for_other) return { slug, available: false, reason: "retired" };
  return { slug, available: true, reason: null };
}

/** Suggest a unique slug for a classroom name (used on the create form). */
export async function suggestSlug(name: string): Promise<string> {
  return generateUniqueSlug("room", name, randomUUID());
}

// ---------------------------------------------------------------------------
// Policy evaluation (pure)
// ---------------------------------------------------------------------------

export interface SlugChangeQuote {
  eligible: boolean;
  /** Credits the NEXT change will cost. 0 = free. */
  costCredits: number;
  changesMade: number;
  /** Null when the policy is fully free (unlimited). */
  freeChangesRemaining: number | null;
  lastChangedAt: string | null;
  nextEligibleAt: string | null;
  policy: SlugPolicy;
}

function addCooldown(from: Date, policy: SlugPolicy): Date {
  const d = new Date(from.getTime());
  if (policy.cooldownUnit === "days") d.setUTCDate(d.getUTCDate() + policy.cooldownValue);
  else if (policy.cooldownUnit === "months") d.setUTCMonth(d.getUTCMonth() + policy.cooldownValue);
  return d;
}

export function evaluateSlugPolicy(
  policy: SlugPolicy,
  history: { changesMade: number; lastChangedAt: Date | null },
  now: Date = new Date()
): SlugChangeQuote {
  if (policy.mode === "free") {
    return {
      eligible: true,
      costCredits: 0,
      changesMade: history.changesMade,
      freeChangesRemaining: null,
      lastChangedAt: history.lastChangedAt?.toISOString() ?? null,
      nextEligibleAt: null,
      policy,
    };
  }
  const freeChangesRemaining = Math.max(policy.freeChanges - history.changesMade, 0);
  const costCredits = freeChangesRemaining > 0 ? 0 : policy.costCredits;
  let nextEligibleAt: Date | null = null;
  if (policy.cooldownUnit !== "none" && history.lastChangedAt) {
    const next = addCooldown(history.lastChangedAt, policy);
    if (next.getTime() > now.getTime()) nextEligibleAt = next;
  }
  return {
    eligible: nextEligibleAt === null,
    costCredits,
    changesMade: history.changesMade,
    freeChangesRemaining,
    lastChangedAt: history.lastChangedAt?.toISOString() ?? null,
    nextEligibleAt: nextEligibleAt?.toISOString() ?? null,
    policy,
  };
}

async function readHistory(roomId: string, client: DbOrTx): Promise<{ changesMade: number; lastChangedAt: Date | null }> {
  const { rows } = await client.execute<{ n: string; last: string | null }>(sql`
    SELECT COUNT(*)::text AS n, MAX(changed_at) AS last FROM classroom_slug_history WHERE room_id = ${roomId}
  `);
  return {
    changesMade: Number(rows[0]?.n ?? 0),
    lastChangedAt: rows[0]?.last ? new Date(rows[0].last) : null,
  };
}

export async function getSlugChangeQuote(roomId: string, rawSettings: unknown): Promise<SlugChangeQuote> {
  const policy = parseClassroomSettings(rawSettings).slugPolicy;
  const orm = await getDb();
  return evaluateSlugPolicy(policy, await readHistory(roomId, orm));
}

export interface SlugHistoryEntry {
  oldSlug: string | null;
  newSlug: string;
  costCredits: number;
  changedAt: string;
}

export async function getSlugHistory(roomId: string): Promise<SlugHistoryEntry[]> {
  const orm = await getDb();
  const rows = await orm
    .select({
      oldSlug: schema.classroomSlugHistory.oldSlug,
      newSlug: schema.classroomSlugHistory.newSlug,
      costCredits: schema.classroomSlugHistory.costCredits,
      changedAt: schema.classroomSlugHistory.changedAt,
    })
    .from(schema.classroomSlugHistory)
    .where(eq(schema.classroomSlugHistory.roomId, roomId))
    .orderBy(sql`${schema.classroomSlugHistory.changedAt} DESC`)
    .limit(50);
  return rows.map((r) => ({
    oldSlug: r.oldSlug,
    newSlug: r.newSlug,
    costCredits: r.costCredits,
    changedAt: (r.changedAt as Date).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// The change transaction
// ---------------------------------------------------------------------------

export interface ChangeSlugInput {
  roomId: string;
  actorId: string;
  newSlug: string;
  /**
   * The cost the creator confirmed in the UI. If the server-side quote has
   * changed since (policy edit, another change landed), the request is
   * rejected rather than silently charging a different amount.
   */
  expectedCostCredits: number;
}

export interface ChangeSlugResult {
  oldSlug: string | null;
  newSlug: string;
  costCredits: number;
}

export async function changeClassroomSlug(input: ChangeSlugInput): Promise<ChangeSlugResult> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    // 1. Lock + ownership + policy re-check inside the transaction.
    const { rows: roomRows } = await tx.execute<{ id: string; slug: string | null; creator_id: string; type: string; classroom_settings: unknown }>(sql`
      SELECT id, slug, creator_id, type, classroom_settings FROM rooms
        WHERE id = ${input.roomId} AND deleted_at IS NULL FOR UPDATE
    `);
    const room = roomRows[0];
    if (!room || room.type !== "classroom") throw notFound("Classroom not found");
    if (room.creator_id !== input.actorId) throw forbidden("Only the classroom creator can change its URL.", "CLASSROOM_FORBIDDEN");

    const newSlug = normaliseSlugInput(input.newSlug);
    if (room.slug === newSlug) throw conflict("That's already this classroom's URL.", "CLASSROOM_SLUG_UNCHANGED");

    const quote = evaluateSlugPolicy(parseClassroomSettings(room.classroom_settings).slugPolicy, await readHistory(room.id, tx));
    if (!quote.eligible) {
      throw forbidden("You changed this classroom's URL too recently.", "CLASSROOM_SLUG_COOLDOWN", {
        nextEligibleAt: quote.nextEligibleAt,
      });
    }
    if (quote.costCredits !== input.expectedCostCredits) {
      throw conflict("The price of this change has been updated — please review and confirm again.", "CLASSROOM_SLUG_PRICE_CHANGED", {
        costCredits: quote.costCredits,
      });
    }

    // 2. Availability, re-checked under the lock.
    const availability = await checkSlugAvailability(newSlug, room.id, tx);
    if (!availability.available) {
      throw conflict("That URL isn't available.", "CLASSROOM_SLUG_UNAVAILABLE", { reason: availability.reason });
    }

    // 3. Charge through the ledger primitive — never raw balance SQL.
    if (quote.costCredits > 0) {
      await debitCoins(
        input.actorId,
        quote.costCredits,
        "classroom_slug_change",
        `classroom_slug_change:${room.id}:${randomUUID()}`,
        "Changed classroom URL",
        { roomId: room.id, oldSlug: room.slug, newSlug },
        tx
      );
    }

    // 4. Update. The partial unique index on rooms.slug is the final race backstop.
    await tx.update(schema.rooms).set({ slug: newSlug, updatedAt: new Date() }).where(eq(schema.rooms.id, room.id));

    // 5. History + 301 from the old slug. If this room is reclaiming one of
    // its own retired slugs, drop that redirect so it doesn't loop.
    await tx
      .delete(schema.slugRedirects)
      .where(and(eq(schema.slugRedirects.entityType, "room"), eq(schema.slugRedirects.oldSlug, newSlug), eq(schema.slugRedirects.entityId, room.id)));

    // Inlined equivalent of lib/slug.ts recordSlugRedirect() — that helper
    // still takes the legacy raw-adapter Queryable type, so its upsert is
    // reproduced here directly against this transaction's Drizzle tx.
    if (room.slug && room.slug !== newSlug) {
      await tx
        .insert(schema.slugRedirects)
        .values({ entityType: "room", oldSlug: room.slug, entityId: room.id })
        .onConflictDoUpdate({
          target: [schema.slugRedirects.entityType, schema.slugRedirects.oldSlug],
          set: { entityId: room.id, createdAt: new Date() },
        });
    }

    await tx.insert(schema.classroomSlugHistory).values({
      roomId: room.id,
      oldSlug: room.slug,
      newSlug,
      changedBy: input.actorId,
      costCredits: quote.costCredits,
    });

    logger.info(
      { roomId: room.id, actorId: input.actorId, oldSlug: room.slug, newSlug, costCredits: quote.costCredits },
      "[classroom:slug] classroom slug changed"
    );

    return { oldSlug: room.slug, newSlug, costCredits: quote.costCredits };
  });
}
