/**
 * app/api/admin/branded-rooms/[brandedRoomId]/route.ts
 *
 * PATCH  /api/admin/branded-rooms/[brandedRoomId]  — Update a branded room sponsorship.
 * DELETE /api/admin/branded-rooms/[brandedRoomId]  — Delete a branded room sponsorship.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db, SqlParam } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PatchBrandedRoomSchema = z.object({
  roomId: z.string().uuid().optional().nullable(),
  brandName: z.string().min(1).max(200).optional(),
  brandLogoUrl: z.string().url().optional().nullable(),
  sponsorBudgetCoins: z.number().int().min(0).optional(),
  joinBonusCoins: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandedRoomRow {
  id: string;
  room_id: string | null;
  brand_name: string;
  brand_logo_url: string | null;
  sponsor_budget_coins: number;
  join_bonus_coins: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
}

interface RouteParams {
  brandedRoomId: string;
}

function formatBrandedRoom(row: BrandedRoomRow) {
  return {
    id: row.id,
    roomId: row.room_id,
    brandName: row.brand_name,
    brandLogoUrl: row.brand_logo_url,
    sponsorBudgetCoins: row.sponsor_budget_coins,
    joinBonusCoins: row.join_bonus_coins,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/branded-rooms/[brandedRoomId]
// ---------------------------------------------------------------------------

/**
 * Update a branded room sponsorship.
 * Supports toggling is_active, updating budget, dates, and other fields.
 * All fields are optional — only provided fields are updated.
 *
 * @returns Updated branded room record
 */
export const PATCH = withAdminAuth<RouteParams>(
  async (req: NextRequest, { params }) => {
    try {
      const { brandedRoomId } = params;

      const body = await req.json().catch(() => ({}));
      const parsed = PatchBrandedRoomSchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest("Invalid update payload", parsed.error.flatten());
      }

      const updates: string[] = [];
      const values: SqlParam[] = [brandedRoomId];
      let idx = 2;

      const {
        roomId,
        brandName,
        brandLogoUrl,
        sponsorBudgetCoins,
        joinBonusCoins,
        isActive,
        startsAt,
        endsAt,
      } = parsed.data;

      if (roomId !== undefined) { updates.push(`room_id = $${idx++}`); values.push(roomId); }
      if (brandName !== undefined) { updates.push(`brand_name = $${idx++}`); values.push(brandName); }
      if (brandLogoUrl !== undefined) { updates.push(`brand_logo_url = $${idx++}`); values.push(brandLogoUrl); }
      if (sponsorBudgetCoins !== undefined) { updates.push(`sponsor_budget_coins = $${idx++}`); values.push(sponsorBudgetCoins); }
      if (joinBonusCoins !== undefined) { updates.push(`join_bonus_coins = $${idx++}`); values.push(joinBonusCoins); }
      if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(isActive); }
      if (startsAt !== undefined) { updates.push(`starts_at = $${idx++}`); values.push(startsAt); }
      if (endsAt !== undefined) { updates.push(`ends_at = $${idx++}`); values.push(endsAt); }

      if (updates.length === 0) {
        throw badRequest("No fields provided to update");
      }

      const { rows } = await db.query<BrandedRoomRow>(
        `UPDATE branded_rooms
         SET ${updates.join(", ")}
         WHERE id = $1
         RETURNING id, room_id, brand_name, brand_logo_url, sponsor_budget_coins,
                   join_bonus_coins, is_active, starts_at, ends_at, created_by, created_at`,
        values
      );

      if (!rows[0]) throw notFound("Branded room not found");

      return NextResponse.json(formatBrandedRoom(rows[0]));
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/branded-rooms/[brandedRoomId]
// ---------------------------------------------------------------------------

/**
 * Delete a branded room sponsorship.
 *
 * @returns 204 No Content on success
 */
export const DELETE = withAdminAuth<RouteParams>(
  async (_req: NextRequest, { params }) => {
    try {
      const { brandedRoomId } = params;

      const { rowCount } = await db.query(
        `DELETE FROM branded_rooms WHERE id = $1`,
        [brandedRoomId]
      );

      if (!rowCount) throw notFound("Branded room not found");

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
