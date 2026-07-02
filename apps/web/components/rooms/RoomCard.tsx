"use client";

/**
 * RoomCard / RoomListRow
 *
 * Room cards for discovery grid + list view.
 * Shows cover emoji/image, room name, type badge, member count,
 * creator name, a favorite (heart) toggle, and a join/enter button.
 *
 * Field names match the canonical camelCase room-card payload produced by
 * `lib/rooms/serialize.ts` (`toRoomCardPayload`) — the same shape returned by
 * GET /api/rooms, /api/rooms/pinned, and /api/rooms/recent, and the shape the
 * Capacitor Android app's shared `Room` type (`shared/types/index.ts`) and the
 * Expo app already expect.
 *
 * @example
 * <RoomCard room={room} onJoin={handleJoin} onToggleFavorite={handleFavorite} />
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { RoomPulseBar } from "@/components/ui/RoomPulseBar";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomType = "free_open" | "vip" | "drop" | "tipping" | "classroom" | "guild";

export interface RoomCardData {
  id: string;
  name: string;
  description: string;
  roomType: RoomType;
  coverEmoji: string;
  coverImageUrl?: string | null;
  slug?: string | null;
  creatorUsername: string;
  memberCount: number;
  maxMembers?: number | null;
  recentMessageCount?: number;
  isJoined: boolean;
  isFavorited?: boolean;
  entryFeeNgn?: number | null;
  subscriptionPriceNgn?: number | null;
  dropEndsAt?: string | null;
  /** Live presence has reached the room's soft cap. */
  isFull?: boolean;
}

interface RoomCardProps {
  room: RoomCardData;
  /** Called when the join/enter button is clicked. */
  onJoin?: (roomId: string) => void;
  joining?: boolean;
  /** Called when the heart/favorite icon is toggled. */
  onToggleFavorite?: (roomId: string, next: boolean) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_BADGE: Record<RoomType, { label: string; classes: string }> = {
  free_open: { label: "Free", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  vip: { label: "VIP", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  drop: { label: "Drop", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  tipping: { label: "Tipping", classes: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  classroom: { label: "ClassRoom", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  guild: { label: "Guild", classes: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

// ---------------------------------------------------------------------------
// Favorite (heart) toggle button — shared between the grid card and list row
// ---------------------------------------------------------------------------

function FavoriteButton({
  roomId,
  isFavorited,
  onToggleFavorite,
}: {
  roomId: string;
  isFavorited?: boolean;
  onToggleFavorite?: (roomId: string, next: boolean) => void;
}) {
  const { t } = useTranslation();
  if (!onToggleFavorite) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(roomId, !isFavorited);
      }}
      aria-label={isFavorited ? t("room.removeFavorite") : t("room.addFavorite")}
      aria-pressed={!!isFavorited}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm transition-colors ${
        isFavorited
          ? "bg-red-100 text-red-500 dark:bg-red-950/50"
          : "bg-black/10 text-white hover:bg-black/20 dark:bg-white/10 dark:text-neutral-200"
      }`}
    >
      {isFavorited ? "❤️" : "🤍"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grid card
// ---------------------------------------------------------------------------

/**
 * Room discovery card.
 * Use in a grid layout (e.g. grid-cols-2 sm:grid-cols-3 gap-3).
 */
export function RoomCard({ room, onJoin, joining, onToggleFavorite }: RoomCardProps) {
  const { label, classes } = TYPE_BADGE[room.roomType];
  const currency = useCurrency();
  const { t } = useTranslation();

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Cover */}
      <Link href={`/rooms/${room.id}`} className="relative block">
        {room.coverImageUrl ? (
          <div className="aspect-video overflow-hidden bg-neutral-100 dark:bg-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={room.coverImageUrl} alt={room.name} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-neutral-100 text-5xl dark:bg-neutral-800">
            {room.coverEmoji}
          </div>
        )}
        <div className="absolute right-2 top-2">
          <FavoriteButton roomId={room.id} isFavorited={room.isFavorited} onToggleFavorite={onToggleFavorite} />
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-start justify-between gap-1.5">
          <Link href={`/rooms/${room.id}`} className="min-w-0 flex-1 hover:underline">
            <h3 className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{room.name}</h3>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {room.isFull && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                {t("room.fullBadge")}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
          </div>
        </div>

        <p className="mb-2 line-clamp-2 text-xs text-neutral-500">{room.description || t("room.noDescription")}</p>

        <div className="mt-auto flex items-center justify-between text-xs text-neutral-400">
          <span>@{room.creatorUsername}</span>
          <span>{(room.memberCount ?? 0).toLocaleString()} {t("rooms.members", { count: room.memberCount ?? 0 })}</span>
        </div>

        {/* Activity pulse bar — shows recent message volume vs capacity */}
        {room.recentMessageCount !== undefined && (
          <RoomPulseBar
            activeCount={room.recentMessageCount}
            maxCapacity={room.maxMembers ?? 10_000}
            className="mt-2"
          />
        )}

        {/* Entry cost note */}
        {room.roomType === "vip" && room.subscriptionPriceNgn != null && (
          <p className="mt-1 text-xs font-semibold text-amber-600">🔒 {room.subscriptionPriceNgn.toLocaleString()} {currency.softPlural?.toLowerCase()}/mo</p>
        )}
        {room.roomType === "drop" && room.entryFeeNgn != null && (
          <p className="mt-1 text-xs font-semibold text-teal-600">🎟️ {room.entryFeeNgn.toLocaleString()} {currency.softPlural?.toLowerCase()} entry</p>
        )}
        {room.roomType === "tipping" && (
          <p className="mt-1 text-xs font-semibold text-green-600">💰 Tipping room</p>
        )}

        {/* Join button */}
        <button
          onClick={() => onJoin?.(room.id)}
          disabled={joining}
          className={`mt-2 w-full rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${room.isJoined ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          {joining ? "…" : room.isJoined ? t("rooms.create.createRoom", "Enter Room") : t("rooms.join")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List row — compact horizontal layout for the list view (default,
// scales better than the grid for large result sets on small screens).
// ---------------------------------------------------------------------------

export function RoomListRow({ room, onJoin, joining, onToggleFavorite }: RoomCardProps) {
  const { label, classes } = TYPE_BADGE[room.roomType];
  const currency = useCurrency();
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={`/rooms/${room.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 text-2xl dark:bg-neutral-800">
          {room.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={room.coverImageUrl} alt={room.name} className="h-full w-full object-cover" />
          ) : (
            room.coverEmoji
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{room.name}</h3>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${classes}`}>{label}</span>
            {room.isFull && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                {t("room.fullBadge")}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-neutral-500">{room.description || t("room.noDescription")}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
            <span>@{room.creatorUsername}</span>
            <span>· {(room.memberCount ?? 0).toLocaleString()} {t("rooms.members", { count: room.memberCount ?? 0 })}</span>
            {room.roomType === "vip" && room.subscriptionPriceNgn != null && (
              <span className="font-semibold text-amber-600">· 🔒 {room.subscriptionPriceNgn.toLocaleString()} {currency.softPlural?.toLowerCase()}/mo</span>
            )}
            {room.roomType === "drop" && room.entryFeeNgn != null && (
              <span className="font-semibold text-teal-600">· 🎟️ {room.entryFeeNgn.toLocaleString()} {currency.softPlural?.toLowerCase()}</span>
            )}
          </div>
        </div>
      </Link>

      <FavoriteButton roomId={room.id} isFavorited={room.isFavorited} onToggleFavorite={onToggleFavorite} />

      <button
        onClick={() => onJoin?.(room.id)}
        disabled={joining}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${room.isJoined ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
      >
        {joining ? "…" : room.isJoined ? "Enter" : t("rooms.join")}
      </button>
    </div>
  );
}
