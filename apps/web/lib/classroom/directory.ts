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

import { and, desc, eq, ilike, isNull, or, sql, SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

function cardSelection(viewerId: string | null) {
  const enrolledExpr = viewerId
    ? sql<boolean>`EXISTS (
        SELECT 1 FROM classroom_enrolments ce
        WHERE ce.room_id = ${schema.rooms.id} AND ce.user_id = ${viewerId}
      )`
    : sql<boolean>`FALSE`;
  return {
    id: schema.rooms.id,
    slug: schema.rooms.slug,
    name: schema.rooms.name,
    description: schema.rooms.description,
    category: schema.rooms.category,
    coverEmoji: schema.rooms.coverEmoji,
    coverImageUrl: schema.rooms.coverImageUrl,
    creatorId: schema.rooms.creatorId,
    creatorUsername: schema.users.username,
    creatorDisplayName: schema.users.displayName,
    creatorAvatarEmoji: schema.users.avatarEmoji,
    enrolmentFeeNgn: schema.rooms.enrolmentFeeNgn,
    memberCount: schema.rooms.memberCount,
    curriculum: schema.rooms.curriculum,
    classStartDate: schema.rooms.classStartDate,
    classEndDate: schema.rooms.classEndDate,
    isActive: schema.rooms.isActive,
    isPublic: schema.rooms.isPublic,
    showInCreatorListing: schema.rooms.showInCreatorListing,
    createdAt: schema.rooms.createdAt,
    isEnrolled: enrolledExpr,
    isPromoted: sql<boolean>`EXISTS (
      SELECT 1 FROM ad_campaigns ac
      WHERE ac.boosted_content_type = 'classroom' AND ac.boosted_content_id = ${schema.rooms.id}
        AND ac.status = 'active'
    )`,
  };
}

type CardSelectionRow = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string | null;
  creatorAvatarEmoji: string;
  enrolmentFeeNgn: bigint | null;
  memberCount: number;
  curriculum: unknown;
  classStartDate: string | null;
  classEndDate: string | null;
  isActive: boolean | null;
  isPublic: boolean | null;
  showInCreatorListing: boolean;
  createdAt: Date | null;
  isEnrolled: boolean;
  isPromoted: boolean;
};

function toCard(r: CardSelectionRow, viewerId: string | null): ClassroomCard {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    coverEmoji: r.coverEmoji,
    coverImageUrl: r.coverImageUrl,
    creatorId: r.creatorId,
    creatorUsername: r.creatorUsername,
    creatorDisplayName: r.creatorDisplayName ?? r.creatorUsername,
    creatorAvatarEmoji: r.creatorAvatarEmoji,
    enrolmentFeeNgn: Number(r.enrolmentFeeNgn ?? 0),
    memberCount: r.memberCount,
    lessonCount: parseModules(r.curriculum).length,
    classStartDate: r.classStartDate,
    classEndDate: r.classEndDate,
    isActive: r.isActive !== false,
    isPublic: r.isPublic !== false,
    showInCreatorListing: r.showInCreatorListing,
    isEnrolled: r.isEnrolled,
    isOwner: viewerId !== null && viewerId === r.creatorId,
    isPromoted: r.isPromoted,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
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

/** Public, active classrooms — searchable by name/description/creator. */
export async function searchDirectory(viewerId: string | null, query: DirectoryQuery): Promise<{ classrooms: ClassroomCard[]; hasMore: boolean }> {
  const orm = await getDb();

  const conditions: SQL[] = [
    eq(schema.rooms.type, "classroom"),
    isNull(schema.rooms.deletedAt),
    eq(schema.rooms.isActive, true),
    eq(schema.rooms.isPublic, true),
    isNull(schema.users.deletedAt),
  ];
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    conditions.push(
      or(
        ilike(schema.rooms.name, term),
        ilike(schema.rooms.description, term),
        ilike(schema.rooms.category, term),
        ilike(schema.users.username, term)
      )!
    );
  }
  if (query.category && query.category.trim()) {
    conditions.push(ilike(schema.rooms.category, query.category.trim()));
  }
  if (query.price === "free") conditions.push(sql`COALESCE(${schema.rooms.enrolmentFeeNgn}, 0) = 0`);
  if (query.price === "paid") conditions.push(sql`COALESCE(${schema.rooms.enrolmentFeeNgn}, 0) > 0`);

  const limit = Math.min(Math.max(Math.floor(query.limit ?? 20), 1), 50);
  const offset = Math.max(Math.floor(query.offset ?? 0), 0);

  // Boosted classrooms (an active boost_content ad campaign) lead, then the chosen sort.
  const rows = (await orm
    .select(cardSelection(viewerId))
    .from(schema.rooms)
    .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
    .where(and(...conditions))
    .orderBy(
      desc(sql`EXISTS (
        SELECT 1 FROM ad_campaigns ac
        WHERE ac.boosted_content_type = 'classroom' AND ac.boosted_content_id = ${schema.rooms.id}
          AND ac.status = 'active'
      )`),
      ...(query.sort === "new"
        ? [desc(schema.rooms.createdAt)]
        : [desc(schema.rooms.memberCount), desc(schema.rooms.createdAt)])
    )
    .limit(limit + 1)
    .offset(offset)) as unknown as CardSelectionRow[];

  return { classrooms: rows.slice(0, limit).map((r) => toCard(r, viewerId)), hasMore: rows.length > limit };
}

/** Distinct categories in use by public classrooms (directory filter chips). */
export async function directoryCategories(): Promise<string[]> {
  const orm = await getDb();
  const rows = await orm
    .select({ category: schema.rooms.category })
    .from(schema.rooms)
    .where(
      and(
        eq(schema.rooms.type, "classroom"),
        isNull(schema.rooms.deletedAt),
        eq(schema.rooms.isActive, true),
        eq(schema.rooms.isPublic, true),
        sql`${schema.rooms.category} IS NOT NULL AND ${schema.rooms.category} <> ''`
      )
    )
    .groupBy(schema.rooms.category)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(20);
  return rows.map((r) => r.category as string);
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
  const orm = await getDb();

  const [creator] = await orm
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarEmoji: schema.users.avatarEmoji,
    })
    .from(schema.users)
    .where(and(sql`LOWER(${schema.users.username}) = LOWER(${username})`, isNull(schema.users.deletedAt)))
    .limit(1);
  if (!creator) throw notFound("Creator not found");
  const isOwner = viewerId === creator.id;

  const conditions: SQL[] = [eq(schema.rooms.creatorId, creator.id), eq(schema.rooms.type, "classroom"), isNull(schema.rooms.deletedAt)];
  if (!isOwner) {
    conditions.push(eq(schema.rooms.isActive, true), eq(schema.rooms.isPublic, true), eq(schema.rooms.showInCreatorListing, true));
  }

  const rows = (await orm
    .select(cardSelection(viewerId))
    .from(schema.rooms)
    .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
    .where(and(...conditions))
    .orderBy(desc(schema.rooms.isActive), desc(schema.rooms.memberCount), desc(schema.rooms.createdAt))
    .limit(200)) as unknown as CardSelectionRow[];

  return {
    creator: {
      id: creator.id,
      username: creator.username,
      displayName: creator.displayName ?? creator.username,
      avatarEmoji: creator.avatarEmoji,
    },
    classrooms: rows.map((r) => toCard(r, viewerId)),
    isOwner,
  };
}
