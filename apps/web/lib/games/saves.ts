/**
 * lib/games/saves.ts
 *
 * Save Slots — lets a user pause an in-progress game and resume it later.
 * Slot count is plan-gated (lib/plans/saveSlots.ts). The limit is enforced
 * here at write time since it's dynamic (admin-configurable) rather than a
 * DB constraint.
 *
 * Reconciliation (fewer slots after a downgrade, or a lapsed subscription
 * past its grace period) always trims oldest-updated-first — this backs
 * both the interactive "pick which slots to delete" flow (client passes
 * explicit `deleteIds`) and the non-interactive CRON purge (no ids passed,
 * so the oldest saves beyond the limit are removed automatically).
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { conflict, notFound, badRequest } from "@/lib/api/errors";
import { getSaveSlotLimit } from "@/lib/plans/saveSlots";

export interface GameSaveRow {
  id: string;
  game_id: string;
  game_slug: string;
  game_name: string;
  cover_emoji: string;
  label: string | null;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface GameSaveWithState extends GameSaveRow {
  state: unknown;
}

const LIST_COLUMNS = `
  gs.id, gs.game_id, g.slug AS game_slug, g.name AS game_name, g.cover_emoji,
  gs.label, gs.score, gs.created_at, gs.updated_at
`;

export async function listSavesForUser(userId: string): Promise<GameSaveRow[]> {
  const db = await getDb();
  const result = await db.execute<GameSaveRow & Record<string, unknown>>(sql`
    SELECT ${sql.raw(LIST_COLUMNS)}
    FROM game_saves gs
    JOIN games g ON g.id = gs.game_id
    WHERE gs.user_id = ${userId}
    ORDER BY gs.updated_at DESC
  `);
  return result.rows;
}

export async function getSaveForUser(userId: string, saveId: string): Promise<GameSaveWithState | null> {
  const db = await getDb();
  const result = await db.execute<GameSaveWithState & Record<string, unknown>>(sql`
    SELECT ${sql.raw(LIST_COLUMNS)}, gs.state
    FROM game_saves gs
    JOIN games g ON g.id = gs.game_id
    WHERE gs.id = ${saveId} AND gs.user_id = ${userId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export interface SlotLimitInfo {
  limit: number;
  count: number;
}

export async function getSlotLimitInfo(userId: string, plan: string): Promise<SlotLimitInfo> {
  const db = await getDb();
  const [limit, result] = await Promise.all([
    getSaveSlotLimit(plan),
    db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM game_saves WHERE user_id = ${userId}`),
  ]);
  return { limit, count: parseInt(result.rows[0]?.count ?? "0", 10) };
}

interface SaveGameParams {
  userId: string;
  plan: string;
  gameId: string;
  saveId?: string | null;
  label?: string | null;
  state: unknown;
  score: number;
}

/**
 * Create a new save or overwrite an existing one (by id, or the caller's
 * existing save for this exact game if any). Throws SAVE_SLOTS_FULL (409)
 * when creating a new save would exceed the plan's slot limit — the
 * response includes the user's current saves so the client can offer
 * "overwrite one of these instead."
 */
export async function upsertSave(params: SaveGameParams): Promise<GameSaveRow> {
  const { userId, plan, gameId, saveId, label, state, score } = params;
  const stateJson = JSON.stringify(state ?? {});

  if (saveId) {
    const db = await getDb();
    const result = await db.execute<{ id: string }>(sql`
      UPDATE game_saves
      SET state = ${stateJson}, score = ${score}, label = COALESCE(${label ?? null}, label), updated_at = NOW()
      WHERE id = ${saveId} AND user_id = ${userId} AND game_id = ${gameId}
      RETURNING id
    `);
    if (!result.rows[0]) throw notFound("Save not found.");
    const updated = await getSaveForUser(userId, result.rows[0].id);
    if (!updated) throw notFound("Save not found.");
    return updated;
  }

  const limit = await getSaveSlotLimit(plan);
  if (limit <= 0) {
    throw badRequest("Your plan does not include save slots.", "SAVE_SLOTS_UNAVAILABLE");
  }

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    // FOR UPDATE can't be applied to an aggregate (COUNT(*)) — lock the
    // actual rows and count them in application code instead. This also
    // serializes concurrent creates for the same user against each other.
    const existingResult = await tx.execute<{ id: string }>(
      sql`SELECT id FROM game_saves WHERE user_id = ${userId} FOR UPDATE`
    );
    const count = existingResult.rows.length;
    if (count >= limit) {
      const err = conflict(
        `You've used all ${limit} of your save slots. Delete one to save a new game.`,
        "SAVE_SLOTS_FULL"
      );
      throw err;
    }

    const insertResult = await tx.execute<{ id: string }>(sql`
      INSERT INTO game_saves (user_id, game_id, label, state, score)
      VALUES (${userId}, ${gameId}, ${label ?? null}, ${stateJson}, ${score})
      RETURNING id
    `);
    const created = await getSaveForUser(userId, insertResult.rows[0].id);
    if (!created) throw notFound("Save not found.");
    return created;
  });
}

export async function deleteSaveForUser(userId: string, saveId: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute<{ id: string }>(
    sql`DELETE FROM game_saves WHERE id = ${saveId} AND user_id = ${userId} RETURNING id`
  );
  if (!result.rows[0]) throw notFound("Save not found.");
}

/**
 * Trims a user's saves down to `limit`, oldest-updated-first. If
 * `deleteIds` is provided, only those (validated to belong to the user)
 * are deleted — used by the interactive "pick which slots to delete" flow.
 * Otherwise, deletes the oldest saves beyond `limit` automatically — used
 * by the CRON downgrade/grace-period sweep.
 *
 * Returns the ids that were deleted.
 */
export async function reconcileSavesForUser(
  userId: string,
  limit: number,
  deleteIds?: string[]
): Promise<string[]> {
  const db = await getDb();
  if (deleteIds && deleteIds.length > 0) {
    const result = await db.execute<{ id: string }>(
      sql`DELETE FROM game_saves WHERE id = ANY(${deleteIds}::uuid[]) AND user_id = ${userId} RETURNING id`
    );
    return result.rows.map((r) => r.id);
  }

  // Keep the `limit` most-recently-updated saves; delete the rest (the
  // oldest ones beyond the limit).
  const result = await db.execute<{ id: string }>(sql`
    DELETE FROM game_saves
    WHERE id IN (
      SELECT id FROM game_saves
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      OFFSET ${Math.max(limit, 0)}
    )
    RETURNING id
  `);
  return result.rows.map((r) => r.id);
}

/** Deletes ALL of a user's saves (used when grace period elapses with no preserved feature, or plan is Free). */
export async function purgeAllSavesForUser(userId: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute<{ id: string }>(
    sql`DELETE FROM game_saves WHERE user_id = ${userId} RETURNING id`
  );
  return result.rows.length;
}
