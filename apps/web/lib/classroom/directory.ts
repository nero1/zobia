/**
 * lib/classroom/directory.ts
 *
 * Classroom discovery: the searchable public directory (Skool-style
 * "discover communities", classroom-only), a creator's public listing page,
 * and the viewer's enrolled classrooms. All three return the same
 * `ClassroomCard` shape so web and Android render one card component.
 *
 * Replaces the old Browse tab's use of GET /api/rooms?type=classroom, whose
 * room-card payload has none of the fields the classroom card reads (title,
 * creatorName, enrolmentFee, startDate…) — every card rendered blank/"Invalid
 * Date" and enrolment state was never shown.
 */

import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db/interface";
import { notFound } from "@/lib/api/errors";
import { parseModules } from "@/lib/classroom/curriculum";

export interface ClassroomCard {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  creatorAvatarEmoji: string;
  enrolmentFeeNgn: number;
  memberCount: number;
  lessonCount: number;
  classStartDate: string | null;
  classEndDate: string | null;
  isActive: boolean;
  isPublic: boolean;
  showInCreatorListing: boolean;
  isEnrolled: boolean;
  isOwner: boolean;
  isPromoted: boolean;
  createdAt: string;
}

interface CardRow {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  creator_id: string;
  creator_username: string;
  creator_display_name: string | null;
  creator_avatar_emoji: string;
  enrolment_fee_ngn: string | number | null;
  member_count: number;
  curriculum: unknown;
  class_start_date: string | null;
  class_end_date: string | null;
  is_active: boolean | null;
  is_public: boolean | null;
  show_in_creator_listing: boolean;
  is_enrolled: boolean;
  is_promoted: boolean;
  created_at: string;
}

const CARD_SELECT = `
  SELECT r.id, r.slug, r.name, r.description, r.category, r.cover_emoji, r.cover_image_url,
         r.creator_id, u.username AS creator_username, u.display_name AS creator_display_name,
         u.avatar_emoji AS creator_avatar_emoji, r.enrolment_fee_ngn, r.member_count, r.curriculum,
         r.class_start_date::text AS class_start_date, r.class_end_date::text AS class_end_date,
         r.is_active, r.is_public, r.show_in_creator_listing, r.created_at,
         (ce.id IS NOT NULL) AS is_enrolled,
         EXISTS (
           SELECT 1 FROM ad_campaigns ac
            WHERE ac.boosted_content_type = 'classroom' AND ac.boosted_content_id = r.id
              AND ac.status = 'active'
         ) AS is_promoted
    FROM rooms r
    JOIN users u ON u.id = r.creator_id
    LEFT JOIN classroom_enrolments ce ON ce.room_id = r.id AND ce.user_id = $1
`;

function toCard(r: CardRow, viewerId: string | null): ClassroomCard {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    coverEmoji: r.cover_emoji,
    coverImageUrl: r.cover_image_url,
    creatorId: r.creator_id,
    creatorUsername: r.creator_username,
    creatorDisplayName: r.creator_display_name ?? r.creator_username,
    creatorAvatarEmoji: r.creator_avatar_emoji,
    enrolmentFeeNgn: Number(r.enrolment_fee_ngn ?? 0),
    memberCount: r.member_count,
    lessonCount: parseModules(r.curriculum).length,
    classStartDate: r.class_start_date,
    classEndDate: r.class_end_date,
    isActive: r.is_active !== false,
    isPublic: r.is_public !== false,
    showInCreatorListing: r.show_in_creator_listing,
    isEnrolled: r.is_enrolled,
    isOwner: viewerId !== null && viewerId === r.creator_id,
    isPromoted: r.is_promoted,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export interface DirectoryQuery {
  q?: string | null;
  category?: string | null;
  price?: "all" | "free" | "paid";
  sort?: "popular" | "new";
  limit?: number;
  offset?: number;
}

function escapeLike(v: string): string {
  return v.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** Public, active classrooms — searchable by name/description/creator. */
export async function searchDirectory(viewerId: string | null, query: DirectoryQuery): Promise<{ classrooms: ClassroomCard[]; hasMore: boolean }> {
  const params: SqlParam[] = [viewerId];
  const where = ["r.type = 'classroom'", "r.deleted_at IS NULL", "r.is_active = TRUE", "r.is_public = TRUE", "u.deleted_at IS NULL"];
  if (query.q && query.q.trim()) {
    params.push(`%${escapeLike(query.q.trim())}%`);
    const p = `$${params.length}`;
    where.push(`(r.name ILIKE ${p} OR r.description ILIKE ${p} OR r.category ILIKE ${p} OR u.username ILIKE ${p})`);
  }
  if (query.category && query.category.trim()) {
    params.push(query.category.trim());
    where.push(`r.category ILIKE $${params.length}`);
  }
  if (query.price === "free") where.push("COALESCE(r.enrolment_fee_ngn, 0) = 0");
  if (query.price === "paid") where.push("COALESCE(r.enrolment_fee_ngn, 0) > 0");

  const limit = Math.min(Math.max(Math.floor(query.limit ?? 20), 1), 50);
  const offset = Math.max(Math.floor(query.offset ?? 0), 0);
  params.push(limit + 1, offset);

  // Boosted classrooms (an active boost_content ad campaign) lead, then the chosen sort.
  const order = query.sort === "new" ? "r.created_at DESC" : "r.member_count DESC, r.created_at DESC";
  const { rows } = await db.query<CardRow>(
    `${CARD_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY is_promoted DESC, ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { classrooms: rows.slice(0, limit).map((r) => toCard(r, viewerId)), hasMore: rows.length > limit };
}

/** Distinct categories in use by public classrooms (directory filter chips). */
export async function directoryCategories(): Promise<string[]> {
  const { rows } = await db.query<{ category: string }>(
    `SELECT category FROM rooms
      WHERE type = 'classroom' AND deleted_at IS NULL AND is_active = TRUE AND is_public = TRUE
        AND category IS NOT NULL AND category <> ''
      GROUP BY category ORDER BY COUNT(*) DESC LIMIT 20`
  );
  return rows.map((r) => r.category);
}

/**
 * A creator's "Classrooms by @username" page. The owner sees every classroom
 * (including hidden/archived ones, flagged); everyone else sees only public,
 * active classrooms the creator opted into the listing.
 */
export async function listCreatorClassrooms(
  username: string,
  viewerId: string | null
): Promise<{ creator: { id: string; username: string; displayName: string; avatarEmoji: string }; classrooms: ClassroomCard[]; isOwner: boolean }> {
  const { rows: userRows } = await db.query<{ id: string; username: string; display_name: string | null; avatar_emoji: string }>(
    `SELECT id, username, display_name, avatar_emoji FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [username]
  );
  const creator = userRows[0];
  if (!creator) throw notFound("Creator not found");
  const isOwner = viewerId === creator.id;

  const visibility = isOwner
    ? ""
    : "AND r.is_active = TRUE AND r.is_public = TRUE AND r.show_in_creator_listing = TRUE";
  const { rows } = await db.query<CardRow>(
    `${CARD_SELECT}
     WHERE r.creator_id = $2 AND r.type = 'classroom' AND r.deleted_at IS NULL ${visibility}
     ORDER BY r.is_active DESC, r.member_count DESC, r.created_at DESC
     LIMIT 200`,
    [viewerId, creator.id]
  );
  return {
    creator: {
      id: creator.id,
      username: creator.username,
      displayName: creator.display_name ?? creator.username,
      avatarEmoji: creator.avatar_emoji,
    },
    classrooms: rows.map((r) => toCard(r, viewerId)),
    isOwner,
  };
}
