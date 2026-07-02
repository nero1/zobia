/**
 * lib/rooms/serialize.ts
 *
 * Serializes a raw `rooms` DB row (snake_case, as returned by `db.query`)
 * into the canonical camelCase room-card payload shared by web, the PWA, and
 * the Capacitor Android app.
 *
 * BUG-ROOMS-CONTRACT: GET /api/rooms, /api/rooms/pinned, and /api/rooms/recent
 * used to return the raw snake_case DB row directly. Every client (web
 * RoomCard, the Android `Room` type in `shared/types`, and the Expo app) reads
 * camelCase fields (`memberCount`, `coverEmoji`, `roomType`, …), so cover
 * emoji, member counts, join state, and pricing silently rendered as
 * `undefined` everywhere a room card was shown. This module is the single
 * place that shape gets produced so every discovery/pinned/recent endpoint
 * stays consistent.
 */

export interface RoomCardSourceRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  category: string | null;
  city: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  slug?: string | null;
  creator_id: string;
  creator_username: string;
  creator_display_name?: string | null;
  creator_avatar_emoji: string;
  creator_tier?: string | null;
  member_count: number;
  max_members: number | null;
  is_active: boolean;
  is_featured?: boolean | null;
  is_sponsored?: boolean | null;
  subscription_price_ngn: number | null;
  entry_fee_ngn: number | null;
  drop_starts_at?: string | null;
  drop_ends_at?: string | null;
  enrolment_fee_ngn: number | null;
  trending_score?: number | null;
  recent_message_count?: number | null;
  total_messages: number;
  health_score: number;
  created_at: string;
  updated_at: string;
}

export interface RoomCardExtras {
  isFull?: boolean;
  presentCount?: number;
  capacity?: number;
  isPromoted?: boolean;
  isJoined?: boolean;
  isFavorited?: boolean;
  lastVisitedAt?: string;
}

export interface RoomCardPayload {
  id: string;
  name: string;
  description: string;
  roomType: string;
  category: string | null;
  city: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  slug: string | null;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  creatorAvatarEmoji: string;
  creatorTier: string | null;
  memberCount: number;
  maxMembers: number | null;
  isActive: boolean;
  isFeatured: boolean;
  isSponsored: boolean;
  subscriptionPriceNgn: number | null;
  entryFeeNgn: number | null;
  dropStartsAt: string | null;
  dropEndsAt: string | null;
  enrolmentFeeNgn: number | null;
  trendingScore: number;
  recentMessageCount: number;
  totalMessages: number;
  healthScore: number;
  createdAt: string;
  updatedAt: string;
  isFull: boolean;
  presentCount: number;
  capacity: number;
  isPromoted: boolean;
  isJoined: boolean;
  isFavorited: boolean;
  lastVisitedAt: string | null;
}

/** Convert a raw `rooms` row (+ discovery-only computed extras) into the canonical card payload. */
export function toRoomCardPayload(
  row: RoomCardSourceRow,
  extras: RoomCardExtras = {}
): RoomCardPayload {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    roomType: row.type,
    category: row.category ?? null,
    city: row.city ?? null,
    coverEmoji: row.cover_emoji,
    coverImageUrl: row.cover_image_url ?? null,
    slug: row.slug ?? null,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    creatorDisplayName: row.creator_display_name ?? row.creator_username,
    creatorAvatarEmoji: row.creator_avatar_emoji,
    creatorTier: row.creator_tier ?? null,
    memberCount: row.member_count,
    maxMembers: row.max_members,
    isActive: row.is_active,
    isFeatured: row.is_featured ?? false,
    isSponsored: row.is_sponsored ?? false,
    subscriptionPriceNgn: row.subscription_price_ngn,
    entryFeeNgn: row.entry_fee_ngn,
    dropStartsAt: row.drop_starts_at ?? null,
    dropEndsAt: row.drop_ends_at ?? null,
    enrolmentFeeNgn: row.enrolment_fee_ngn,
    trendingScore: row.trending_score ?? 0,
    recentMessageCount: row.recent_message_count ?? 0,
    totalMessages: row.total_messages,
    healthScore: row.health_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isFull: extras.isFull ?? false,
    presentCount: extras.presentCount ?? 0,
    capacity: extras.capacity ?? row.max_members ?? 0,
    isPromoted: extras.isPromoted ?? false,
    isJoined: extras.isJoined ?? false,
    isFavorited: extras.isFavorited ?? false,
    lastVisitedAt: extras.lastVisitedAt ?? null,
  };
}
