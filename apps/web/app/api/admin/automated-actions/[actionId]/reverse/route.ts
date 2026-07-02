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
import { db } from "@/lib/db";
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

    // -----------------------------------------------------------------------
    // 1. Fetch the automated action from the log
    // -----------------------------------------------------------------------

    const { rows: actionRows } = await db.query<AutomatedActionRow>(
      `SELECT id, action_type, target_type, target_id, target_user_id, metadata, reversed_at, created_at
       FROM automated_actions_log
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [actionId]
    );

    const action = actionRows[0];
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
        await db.query(
          `UPDATE messages
           SET deleted_at = NULL,
               deleted_by = NULL
           WHERE id = $1`,
          [action.target_id]
        );
      }
    } else if (action.action_type === "user_flagged") {
      // Restore trust score (capped at 100)
      if (action.target_user_id) {
        await db.query(
          `UPDATE users
           SET trust_score = LEAST(trust_score + 5, 100),
               updated_at  = NOW()
           WHERE id = $1`,
          [action.target_user_id]
        );
      }
    } else if (action.action_type === "xp_stripped") {
      // Credit the stripped XP back based on the amount stored in metadata
      const xpAmount = action.metadata?.xp_amount;
      if (action.target_user_id && typeof xpAmount === "number" && xpAmount > 0) {
        await db.query(
          `UPDATE users
           SET legacy_score = legacy_score + $1,
               updated_at   = NOW()
           WHERE id = $2`,
          [xpAmount, action.target_user_id]
        );

        // Restore xp_total via the canonical safeAwardXP path, which also
        // writes the compensatory xp_ledger entry (with the required NOT
        // NULL base_amount) and dedupes on reference_id.
        await safeAwardXP(
          action.target_user_id,
          xpAmount,
          "main",
          "reversal_xp_restored",
          `reversal:${actionId}`,
          db
        );
      }
    }
    // For any other action types we skip the domain mutation but still
    // mark the log entry as reversed so the admin audit trail is complete.

    // -----------------------------------------------------------------------
    // 4. Mark the action as reversed in the log
    // -----------------------------------------------------------------------

    const { rows: updatedRows } = await db.query<{ reversed_at: string }>(
      `UPDATE automated_actions_log
       SET reversed_at  = NOW(),
           reversed_by  = $1,
           reverse_note = $2
       WHERE id = $3
       RETURNING reversed_at`,
      [auth.user.sub, body.note ?? null, actionId]
    );

    const reversedAt = updatedRows[0]?.reversed_at ?? new Date().toISOString();

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
