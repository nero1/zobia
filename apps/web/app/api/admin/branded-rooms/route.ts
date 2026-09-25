export const dynamic = 'force-dynamic';

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
import { eq, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { contributeToCreatorFund } from "@/lib/creator/fundContribution";

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
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.brandedRooms.id,
        room_id: schema.brandedRooms.roomId,
        brand_name: schema.brandedRooms.brandName,
        brand_logo_url: schema.brandedRooms.brandLogoUrl,
        sponsor_budget_coins: schema.brandedRooms.sponsorBudgetCoins,
        join_bonus_coins: schema.brandedRooms.joinBonusCoins,
        is_active: schema.brandedRooms.isActive,
        starts_at: schema.brandedRooms.startsAt,
        ends_at: schema.brandedRooms.endsAt,
        created_by: schema.brandedRooms.createdBy,
        created_at: schema.brandedRooms.createdAt,
        room_name: schema.rooms.name,
        room_type: schema.rooms.type,
      })
      .from(schema.brandedRooms)
      .leftJoin(schema.rooms, eq(schema.rooms.id, schema.brandedRooms.roomId))
      .orderBy(sql`${schema.brandedRooms.createdAt} DESC`);

    return NextResponse.json({
      brandedRooms: rows.map((r) =>
        formatBrandedRoom({
          ...r,
          sponsor_budget_coins: Number(r.sponsor_budget_coins),
          created_at: r.created_at ? r.created_at.toISOString() : "",
          starts_at: r.starts_at ? r.starts_at.toISOString() : null,
          ends_at: r.ends_at ? r.ends_at.toISOString() : null,
        } as unknown as BrandedRoomRow)
      ),
    });
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
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateBrandedRoomSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid branded room payload", parsed.error.flatten());
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

    const orm = await getDb();
    const [newRow] = await orm
      .insert(schema.brandedRooms)
      .values({
        roomId: roomId ?? null,
        brandName,
        brandLogoUrl: brandLogoUrl ?? null,
        sponsorBudgetCoins: BigInt(sponsorBudgetCoins),
        joinBonusCoins,
        isActive: true,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdBy: auth.user.sub,
      })
      .returning();

    // Seed the Creator Fund from sponsor budget (PRD §14; percent is
    // admin-configurable). lib/creator/fundContribution.ts is not yet
    // migrated to Drizzle (see its own header note — it must stay atomic
    // with several still-legacy modules in the payments webhook path), so
    // it is called here with its default (legacy pooled) client rather than
    // inside a shared transaction with the insert above.
    await contributeToCreatorFund(sponsorBudgetCoins, "sponsor_budget");

    const created: BrandedRoomRow = {
      id: newRow.id,
      room_id: newRow.roomId,
      brand_name: newRow.brandName,
      brand_logo_url: newRow.brandLogoUrl,
      sponsor_budget_coins: Number(newRow.sponsorBudgetCoins),
      join_bonus_coins: newRow.joinBonusCoins,
      is_active: newRow.isActive ?? true,
      starts_at: newRow.startsAt ? newRow.startsAt.toISOString() : null,
      ends_at: newRow.endsAt ? newRow.endsAt.toISOString() : null,
      created_by: newRow.createdBy,
      created_at: newRow.createdAt ? newRow.createdAt.toISOString() : "",
      room_name: null,
      room_type: null,
    };

    return NextResponse.json(formatBrandedRoom(created), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
