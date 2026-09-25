export const dynamic = 'force-dynamic';

/**
 * app/api/admin/automated-actions/[actionId]/reverse/route.ts
 *
 * POST /api/admin/automated-actions/:actionId/reverse
 *
 * Reverses a previously logged automated action. Used by admins to undo
 * false-positive moderation decisions made by the automated trust-safety
 * system.
 *
 * Supported action types and their reversal effects:
 *   - content_removed  → Restore the message (clear deleted_at / deleted_by)
 *   - user_flagged     → Add 5 points back to the user's trust score (capped at 100)
 *   - xp_stripped      → Credit the stripped XP back (amount from metadata.xp_amount)
 *
 * All reversals update automated_actions_log with reversed_at, reversed_by,
 * and an optional admin note.
 *
 * Body: { note?: string }   — Optional admin note (max 500 chars) for the audit trail.
 *
 * Auth: admin only (withAdminAuth — live database is_admin check).
 * Rate limit: RATE_LIMITS.admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const reverseActionSchema = z.object({
  /** Optional admin note explaining the reason for reversal. */
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface AutomatedActionRow {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  reversed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Route params type
// ---------------------------------------------------------------------------

interface ActionParams {
  actionId: string;
}

// ---------------------------------------------------------------------------
// POST /api/admin/automated-actions/[actionId]/reverse
// ---------------------------------------------------------------------------

/**
 * Reverse an automated moderation action.
 *
 * Idempotency: if the action has already been reversed, returns 400.
 *
 * @returns { ok: true, actionId, reversedAt }
 */
export const POST = withAdminAuth<ActionParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { actionId } = await params as ActionParams;
    const body = await validateBody(req, reverseActionSchema);

    const orm = await getDb();

    // -----------------------------------------------------------------------
    // 1. Fetch the automated action from the log
    // -----------------------------------------------------------------------
    // BUG-FIX: `automated_actions_log` has no `deleted_at` column (never has,
    // in any migration) — the previous raw-SQL query filtered on
    // `deleted_at IS NULL`, which meant every call to this endpoint failed
    // with a Postgres "column does not exist" error. This table has no
    // soft-delete concept, so the fix is simply to drop that bogus filter.

    const [actionRow] = await orm
      .select({
        id: schema.automatedActionsLog.id,
        actionType: schema.automatedActionsLog.actionType,
        targetType: schema.automatedActionsLog.targetType,
        targetId: schema.automatedActionsLog.targetId,
        targetUserId: schema.automatedActionsLog.targetUserId,
        metadata: schema.automatedActionsLog.metadata,
        reversedAt: schema.automatedActionsLog.reversedAt,
        createdAt: schema.automatedActionsLog.createdAt,
      })
      .from(schema.automatedActionsLog)
      .where(eq(schema.automatedActionsLog.id, actionId))
      .limit(1);

    const action: AutomatedActionRow | undefined = actionRow
      ? {
          id: actionRow.id,
          action_type: actionRow.actionType,
          target_type: actionRow.targetType,
          target_id: actionRow.targetId,
          target_user_id: actionRow.targetUserId,
          metadata: actionRow.metadata as Record<string, unknown> | null,
          reversed_at: actionRow.reversedAt ? actionRow.reversedAt.toISOString() : null,
          created_at: actionRow.createdAt ? actionRow.createdAt.toISOString() : "",
        }
      : undefined;
    if (!action) {
      throw notFound("Automated action not found");
    }

    // -----------------------------------------------------------------------
    // 2. Guard against double-reversal
    // -----------------------------------------------------------------------

    if (action.reversed_at !== null) {
      throw badRequest("Action already reversed", "ALREADY_REVERSED");
    }

    // -----------------------------------------------------------------------
    // 3. Apply the type-specific reversal
    // -----------------------------------------------------------------------

    if (action.action_type === "content_removed") {
      // Restore the content by clearing the soft-delete markers
      if (action.target_id) {
        await orm
          .update(schema.messages)
          .set({ deletedAt: null, deletedBy: null })
          .where(eq(schema.messages.id, action.target_id));
      }
    } else if (action.action_type === "user_flagged") {
      // Restore trust score (capped at 100)
      if (action.target_user_id) {
        await orm
          .update(schema.users)
          .set({
            trustScore: sql`LEAST(${schema.users.trustScore} + 5, 100)`,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, action.target_user_id));
      }
    } else if (action.action_type === "xp_stripped") {
      // Credit the stripped XP back based on the amount stored in metadata
      const xpAmount = action.metadata?.xp_amount;
      if (action.target_user_id && typeof xpAmount === "number" && xpAmount > 0) {
        await orm
          .update(schema.users)
          .set({
            legacyScore: sql`${schema.users.legacyScore} + ${xpAmount}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, action.target_user_id));

        // Restore xp_total via the canonical safeAwardXP path, which also
        // writes the compensatory xp_ledger entry (with the required NOT
        // NULL base_amount) and dedupes on reference_id.
        // No explicit dbClient passed — defaults to the shared global adapter,
        // matching this route's previous behavior of passing the same instance.
        await safeAwardXP(
          action.target_user_id,
          xpAmount,
          "main",
          "reversal_xp_restored",
          `reversal:${actionId}`
        );
      }
    }
    // For any other action types we skip the domain mutation but still
    // mark the log entry as reversed so the admin audit trail is complete.

    // -----------------------------------------------------------------------
    // 4. Mark the action as reversed in the log
    // -----------------------------------------------------------------------

    const [updatedRow] = await orm
      .update(schema.automatedActionsLog)
      .set({
        reversedAt: new Date(),
        reversedBy: auth.user.sub,
        reverseNote: body.note ?? null,
      })
      .where(eq(schema.automatedActionsLog.id, actionId))
      .returning({ reversedAt: schema.automatedActionsLog.reversedAt });

    const reversedAt = updatedRow?.reversedAt ?? new Date().toISOString();

    return NextResponse.json(
      {
        ok: true,
        actionId,
        reversedAt,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
