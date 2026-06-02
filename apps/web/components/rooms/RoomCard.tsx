"use client";

/**
 * RoomCard
 *
 * Room card for discovery grid.
 * Shows cover emoji/image, room name, type badge, member count,
 * creator name, and a join/enter button.
 *
 * @example
 * <RoomCard room={room} onJoin={handleJoin} />
 */

import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomType = "public" | "vip" | "drop" | "classroom" | "guild";

export interface RoomCardData {
  id: string;
  name: string;
  description: string;
  type: RoomType;
  coverEmoji: string;
  coverImageUrl?: string;
  creatorUsername: string;
  memberCount: number;
  isJoined: boolean;
  entryFee?: number; // coins, for drop rooms
  subscriptionPrice?: number; // coins, for vip rooms
}

interface RoomCardProps {
  room: RoomCardData;
  /** Called when the join/enter button is clicked. */
  onJoin?: (roomId: string) => void;
  joining?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_BADGE: Record<RoomType, { label: string; classes: string }> = {
  public: { label: "Public", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  vip: { label: "VIP", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  drop: { label: "Drop", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  classroom: { label: "ClassRoom", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  guild: { label: "Guild", classes: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Room discovery card.
 * Use in a grid layout (e.g. grid-cols-2 sm:grid-cols-3 gap-3).
 */
export function RoomCard({ room, onJoin, joining }: RoomCardProps) {
  const { label, classes } = TYPE_BADGE[room.type];

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Cover */}
      <Link href={`/rooms/${room.id}`} className="block">
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
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-start justify-between gap-1.5">
          <Link href={`/rooms/${room.id}`} className="min-w-0 flex-1 hover:underline">
            <h3 className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{room.name}</h3>
          </Link>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
        </div>

        <p className="mb-2 line-clamp-2 text-xs text-neutral-500">{room.description || "No description."}</p>

        <div className="mt-auto flex items-center justify-between text-xs text-neutral-400">
          <span>@{room.creatorUsername}</span>
          <span>{room.memberCount.toLocaleString()} members</span>
        </div>

        {/* Entry cost note */}
        {room.type === "vip" && room.subscriptionPrice && (
          <p className="mt-1 text-xs font-semibold text-amber-600">🔒 {room.subscriptionPrice.toLocaleString()} coins/mo</p>
        )}
        {room.type === "drop" && room.entryFee && (
          <p className="mt-1 text-xs font-semibold text-teal-600">🎟️ {room.entryFee.toLocaleString()} coins entry</p>
        )}

        {/* Join button */}
        <button
          onClick={() => onJoin?.(room.id)}
          disabled={joining}
          className={`mt-2 w-full rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${room.isJoined ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          {joining ? "…" : room.isJoined ? "Enter Room" : "Join"}
        </button>
      </div>
    </div>
  );
}
