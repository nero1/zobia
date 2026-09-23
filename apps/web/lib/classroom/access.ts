/**
 * lib/classroom/access.ts
 *
 * Single source of truth for "who is this viewer to this classroom?". Every
 * classroom API route resolves the classroom and the caller's role through
 * `loadClassroomContext()` (one query) and then asserts the specific
 * capability it needs with `requireCapability()` — authorization is always
 * decided server-side here, never from anything the client sends.
 *
 * Roles, strongest first:
 *   - staff     platform admin / moderator (DB-checked, not JWT) — full moderation
 *   - creator   rooms.creator_id — everything
 *   - moderator active classroom_moderators row — the subset of moderation
 *               powers the creator enabled in classroom_settings.moderatorPermissions
 *   - member    classroom_enrolments row — read member content, post (per
 *               postingPolicy), comment, like, report, complete lessons
 *   - visitor   anyone else — public classroom info only
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { forbidden, notFound } from "@/lib/api/errors";
import { parseClassroomSettings, type ClassroomSettings } from "@/lib/classroom/settings";

export interface ClassroomRecord {
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
  creatorAvatarUrl: string | null;
  isPublic: boolean;
  isActive: boolean;
  /** Null until the creator's first Publish click (isPublic stays the
   *  operative visibility gate — this is metadata for "has this classroom
   *  ever gone live", used by studio UI and creator-facing plan limits). */
  publishedAt: string | null;
  enrolmentFeeNgn: number;
  memberCount: number;
  maxMembers: number | null;
  curriculum: unknown;
  classStartDate: string | null;
  classEndDate: string | null;
  showInCreatorListing: boolean;
  settings: ClassroomSettings;
  createdAt: string;
  updatedAt: string;
}

export type ClassroomRole = "staff" | "creator" | "moderator" | "member" | "visitor";

export interface ClassroomCapabilities {
  /** See member-only content (feed, meeting links, recordings, leaderboard). */
  viewMemberContent: boolean;
  createPost: boolean;
  comment: boolean;
  like: boolean;
  report: boolean;
  completeLessons: boolean;
  managePosts: boolean;
  manageMembers: boolean;
  manageEvents: boolean;
  handleReports: boolean;
  /** Settings, pricing, slug, curriculum, moderators, deletion. Creator (or staff) only. */
  manageClassroom: boolean;
}

export interface ClassroomViewer {
  userId: string | null;
  role: ClassroomRole;
  isCreator: boolean;
  isModerator: boolean;
  isEnrolled: boolean;
  isStaff: boolean;
  mutedUntil: string | null;
  can: ClassroomCapabilities;
}

export interface ClassroomContext {
  classroom: ClassroomRecord;
  viewer: ClassroomViewer;
}

interface ContextRow {
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
  creator_avatar_url: string | null;
  is_public: boolean | null;
  is_active: boolean | null;
  published_at: string | null;
  enrolment_fee_ngn: string | number | null;
  member_count: number;
  max_members: number | null;
  curriculum: unknown;
  class_start_date: string | null;
  class_end_date: string | null;
  show_in_creator_listing: boolean;
  classroom_settings: unknown;
  created_at: string;
  updated_at: string;
  viewer_enrolled: boolean;
  viewer_muted_until: string | null;
  viewer_is_moderator: boolean;
  viewer_is_staff: boolean;
}

type Queryable = Pick<TransactionClient, "query">;

/**
 * Load a classroom (by id or current slug) plus the viewer's role.
 * Throws 404 for missing/deleted rooms and for non-classroom room types.
 * Archived (is_active = false) classrooms still load — callers that must
 * reject writes to archived classrooms check `classroom.isActive`.
 */
export async function loadClassroomContext(
  identifier: { id: string } | { slug: string },
  viewerId: string | null,
  client: Queryable = db
): Promise<ClassroomContext> {
  const byId = "id" in identifier;
  const { rows } = await client.query<ContextRow>(
    `SELECT r.id, r.slug, r.name, r.description, r.category, r.cover_emoji, r.cover_image_url,
            r.creator_id, u.username AS creator_username, u.display_name AS creator_display_name,
            u.avatar_emoji AS creator_avatar_emoji, u.avatar_url AS creator_avatar_url,
            r.is_public, r.is_active, r.published_at, r.enrolment_fee_ngn, r.member_count, r.max_members,
            r.curriculum, r.class_start_date::text AS class_start_date,
            r.class_end_date::text AS class_end_date, r.show_in_creator_listing,
            r.classroom_settings, r.created_at, r.updated_at,
            (ce.id IS NOT NULL) AS viewer_enrolled,
            ce.muted_until AS viewer_muted_until,
            (cm.id IS NOT NULL) AS viewer_is_moderator,
            COALESCE(vu.is_admin OR vu.is_moderator, FALSE) AS viewer_is_staff
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN classroom_enrolments ce ON ce.room_id = r.id AND ce.user_id = $2
       LEFT JOIN classroom_moderators cm
              ON cm.room_id = r.id AND cm.user_id = $2 AND cm.status = 'active' AND cm.is_moderator = TRUE
       LEFT JOIN users vu ON vu.id = $2 AND vu.deleted_at IS NULL
      WHERE r.${byId ? "id" : "slug"} = $1
        AND r.type = 'classroom'
        AND r.deleted_at IS NULL
      LIMIT 1`,
    [byId ? identifier.id : identifier.slug, viewerId]
  );
  const row = rows[0];
  if (!row) throw notFound("Classroom not found");

  const classroom: ClassroomRecord = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    coverEmoji: row.cover_emoji,
    coverImageUrl: row.cover_image_url,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    creatorDisplayName: row.creator_display_name ?? row.creator_username,
    creatorAvatarEmoji: row.creator_avatar_emoji,
    creatorAvatarUrl: row.creator_avatar_url,
    isPublic: row.is_public !== false,
    isActive: row.is_active !== false,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    enrolmentFeeNgn: Number(row.enrolment_fee_ngn ?? 0),
    memberCount: row.member_count,
    maxMembers: row.max_members,
    curriculum: row.curriculum,
    classStartDate: row.class_start_date,
    classEndDate: row.class_end_date,
    showInCreatorListing: row.show_in_creator_listing,
    settings: parseClassroomSettings(row.classroom_settings),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };

  const viewer = resolveViewer(classroom, {
    userId: viewerId,
    enrolled: row.viewer_enrolled,
    moderator: row.viewer_is_moderator,
    staff: row.viewer_is_staff,
    mutedUntil: row.viewer_muted_until,
  });

  return { classroom, viewer };
}

/** Pure role/capability resolution — exported for unit tests. */
export function resolveViewer(
  classroom: Pick<ClassroomRecord, "creatorId" | "settings" | "isActive">,
  input: { userId: string | null; enrolled: boolean; moderator: boolean; staff: boolean; mutedUntil: string | null }
): ClassroomViewer {
  const isCreator = input.userId !== null && input.userId === classroom.creatorId;
  const isStaff = input.userId !== null && input.staff;
  const isModerator = input.userId !== null && input.moderator && !isCreator;
  const isEnrolled = input.userId !== null && input.enrolled;

  const role: ClassroomRole = isStaff
    ? "staff"
    : isCreator
      ? "creator"
      : isModerator
        ? "moderator"
        : isEnrolled
          ? "member"
          : "visitor";

  const perms = classroom.settings.moderatorPermissions;
  const owner = isCreator || isStaff;
  const insider = owner || isModerator || isEnrolled;
  const muted =
    !owner && !isModerator && input.mutedUntil !== null && new Date(input.mutedUntil).getTime() > Date.now();
  const writable = classroom.isActive;

  const can: ClassroomCapabilities = {
    viewMemberContent: insider,
    createPost:
      writable &&
      !muted &&
      (owner || isModerator || (isEnrolled && classroom.settings.postingPolicy === "members")),
    comment: writable && insider && !muted,
    like: writable && insider,
    report: insider && !owner,
    completeLessons: writable && (isEnrolled || owner || isModerator),
    managePosts: owner || (isModerator && perms.managePosts),
    manageMembers: owner || (isModerator && perms.manageMembers),
    manageEvents: owner || (isModerator && perms.manageEvents),
    handleReports: owner || (isModerator && perms.handleReports),
    manageClassroom: owner,
  };

  return {
    userId: input.userId,
    role,
    isCreator,
    isModerator,
    isEnrolled,
    isStaff,
    mutedUntil: muted && input.mutedUntil ? new Date(input.mutedUntil).toISOString() : null,
    can,
  };
}

const CAPABILITY_MESSAGES: Record<keyof ClassroomCapabilities, string> = {
  viewMemberContent: "Enrol in this classroom to see its community and content.",
  createPost: "You can't post in this classroom right now.",
  comment: "You can't comment in this classroom right now.",
  like: "Enrol in this classroom to like posts.",
  report: "You can't report content in this classroom.",
  completeLessons: "Enrol in this classroom to track lesson progress.",
  managePosts: "Only the creator or a moderator can manage posts.",
  manageMembers: "Only the creator or a moderator can manage members.",
  manageEvents: "Only the creator or a moderator can manage live sessions.",
  handleReports: "Only the creator or a moderator can review reports.",
  manageClassroom: "Only the classroom creator can do this.",
};

/** Throw 403 unless the viewer holds `capability`. */
export function requireCapability(viewer: ClassroomViewer, capability: keyof ClassroomCapabilities): void {
  if (!viewer.can[capability]) {
    throw forbidden(CAPABILITY_MESSAGES[capability], "CLASSROOM_FORBIDDEN", { capability });
  }
}
