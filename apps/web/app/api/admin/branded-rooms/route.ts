/**
 * app/api/admin/branded-rooms/route.ts
 *
 * GET  /api/admin/branded-rooms  — List all branded rooms with room info.
 * POST /api/admin/branded-rooms  — Create a new branded room sponsorship.
 *
 * PRD §17 — Branded Rooms: Companies sponsor a dedicated Room. Appears in
 * discovery with a 'Sponsored' tag. Members who join earn a small coin bonus
 * funded by the brand.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBrandedRoomSchema = z.object({
  roomId: z.string().uuid().optional().nullable(),
  brandName: z.string().min(1).max(200),
  brandLogoUrl: z.string().url().optional().nullable(),
  sponsorBudgetCoins: z.number().int().min(0),
  joinBonusCoins: z.number().int().min(0),
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
  // Joined from rooms table
  room_name: string | null;
  room_type: string | null;
}

function formatBrandedRoom(row: BrandedRoomRow) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomName: row.room_name ?? null,
    roomType: row.room_type ?? null,
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
// GET /api/admin/branded-rooms
// ---------------------------------------------------------------------------

/**
 * List all branded rooms with a JOIN to the rooms table for room name/type.
 *
 * @returns { brandedRooms: BrandedRoom[] }
 */
export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<BrandedRoomRow>(
      `SELECT
         br.id,
         br.room_id,
         br.brand_name,
         br.brand_logo_url,
         br.sponsor_budget_coins,
         br.join_bonus_coins,
         br.is_active,
         br.starts_at,
         br.ends_at,
         br.created_by,
         br.created_at,
         r.name  AS room_name,
         r.type  AS room_type
       FROM branded_rooms br
       LEFT JOIN rooms r ON r.id = br.room_id
       ORDER BY br.created_at DESC`
    );

    return NextResponse.json({ brandedRooms: rows.map(formatBrandedRoom) });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/branded-rooms
// ---------------------------------------------------------------------------

/**
 * Create a new branded room sponsorship.
 *
 * @returns Created branded room record (201)
 */
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateBrandedRoomSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid branded room payload", parsed.error.flatten());
    }

    const {
      roomId,
      brandName,
      brandLogoUrl,
      sponsorBudgetCoins,
      joinBonusCoins,
      startsAt,
      endsAt,
    } = parsed.data;

    const { rows } = await db.query<BrandedRoomRow>(
      `INSERT INTO branded_rooms
         (room_id, brand_name, brand_logo_url, sponsor_budget_coins,
          join_bonus_coins, is_active, starts_at, ends_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, NOW())
       RETURNING
         id, room_id, brand_name, brand_logo_url, sponsor_budget_coins,
         join_bonus_coins, is_active, starts_at, ends_at, created_by, created_at,
         NULL AS room_name, NULL AS room_type`,
      [
        roomId ?? null,
        brandName,
        brandLogoUrl ?? null,
        sponsorBudgetCoins,
        joinBonusCoins,
        startsAt ?? null,
        endsAt ?? null,
        auth.user.sub,
      ]
    );

    return NextResponse.json(formatBrandedRoom(rows[0]), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
