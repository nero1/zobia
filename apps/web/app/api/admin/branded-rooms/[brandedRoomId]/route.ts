export const dynamic = 'force-dynamic';

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
import { eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

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

      const updates: Partial<typeof schema.brandedRooms.$inferInsert> = {};
      if (roomId !== undefined) updates.roomId = roomId;
      if (brandName !== undefined) updates.brandName = brandName;
      if (brandLogoUrl !== undefined) updates.brandLogoUrl = brandLogoUrl;
      if (sponsorBudgetCoins !== undefined) updates.sponsorBudgetCoins = BigInt(sponsorBudgetCoins);
      if (joinBonusCoins !== undefined) updates.joinBonusCoins = joinBonusCoins;
      if (isActive !== undefined) updates.isActive = isActive;
      if (startsAt !== undefined) updates.startsAt = startsAt ? new Date(startsAt) : null;
      if (endsAt !== undefined) updates.endsAt = endsAt ? new Date(endsAt) : null;

      if (Object.keys(updates).length === 0) {
        throw badRequest("No fields provided to update");
      }

      const orm = await getDb();
      const [row] = await orm
        .update(schema.brandedRooms)
        .set(updates)
        .where(eq(schema.brandedRooms.id, brandedRoomId))
        .returning();

      if (!row) throw notFound("Branded room not found");

      return NextResponse.json(
        formatBrandedRoom({
          id: row.id,
          room_id: row.roomId,
          brand_name: row.brandName,
          brand_logo_url: row.brandLogoUrl,
          sponsor_budget_coins: Number(row.sponsorBudgetCoins),
          join_bonus_coins: row.joinBonusCoins,
          is_active: row.isActive ?? false,
          starts_at: row.startsAt ? row.startsAt.toISOString() : null,
          ends_at: row.endsAt ? row.endsAt.toISOString() : null,
          created_by: row.createdBy,
          created_at: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
        })
      );
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

      const orm = await getDb();
      const deleted = await orm
        .delete(schema.brandedRooms)
        .where(eq(schema.brandedRooms.id, brandedRoomId))
        .returning({ id: schema.brandedRooms.id });

      if (deleted.length === 0) throw notFound("Branded room not found");

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
