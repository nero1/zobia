"use client";

/**
 * app/(admin)/admin/branded-rooms/page.tsx
 *
 * Branded / Sponsored Rooms manager for admin panel.
 *
 * PRD §17 — Companies sponsor a dedicated Room. Appears in discovery with a
 * 'Sponsored' tag. Members who join earn a small coin bonus funded by the brand.
 *
 * Features:
 * - Table of all branded rooms with status badges, budget, schedule, and actions
 * - Create new sponsorship via an inline form
 * - Toggle active/inactive per row
 * - Delete with confirmation
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandedRoom {
  id: string;
  roomId: string | null;
  roomName: string | null;
  roomType: string | null;
  brandName: string;
  brandLogoUrl: string | null;
  sponsorBudgetCoins: number;
  joinBonusCoins: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

type RoomStatus = "active" | "inactive" | "scheduled" | "ended";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoomStatus(room: BrandedRoom): RoomStatus {
  const now = Date.now();
  if (room.startsAt && new Date(room.startsAt).getTime() > now) return "scheduled";
  if (room.endsAt && new Date(room.endsAt).getTime() < now) return "ended";
  return room.isActive ? "active" : "inactive";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<RoomStatus, string> = {
  active: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  inactive: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  ended: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
};

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

interface CreateFormProps {
  onSave: (data: {
    brandName: string;
    brandLogoUrl: string | null;
    roomId: string | null;
    sponsorBudgetCoins: number;
    joinBonusCoins: number;
    startsAt: string | null;
    endsAt: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}

function CreateForm({ onSave, onCancel }: CreateFormProps) {
  const [brandName, setBrandName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [roomId, setRoomId] = useState("");
  const [sponsorBudgetCoins, setSponsorBudgetCoins] = useState(10000);
  const [joinBonusCoins, setJoinBonusCoins] = useState(50);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        brandName,
        brandLogoUrl: brandLogoUrl.trim() || null,
        roomId: roomId.trim() || null,
        sponsorBudgetCoins,
        joinBonusCoins,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branded room");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <h3 className="mb-4 text-sm font-bold text-neutral-800 dark:text-neutral-200">
        New Branded Room Sponsorship
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Brand Name <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Acme Corp"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Brand Logo URL
          </label>
          <input
            type="url"
            value={brandLogoUrl}
            onChange={(e) => setBrandLogoUrl(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="https://example.com/logo.png"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Room ID (optional)
          </label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="UUID of the room to sponsor"
          />
          <p className="mt-1 text-xs text-neutral-400">Leave blank to create an unlinked sponsorship</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Join Bonus (coins) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min={0}
            value={joinBonusCoins}
            onChange={(e) => setJoinBonusCoins(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <p className="mt-1 text-xs text-neutral-400">Coins awarded to each member who joins the room</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Sponsor Budget (coins) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min={0}
            value={sponsorBudgetCoins}
            onChange={(e) => setSponsorBudgetCoins(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <p className="mt-1 text-xs text-neutral-400">Total coin budget funded by the brand</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Starts At
            </label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Ends At
            </label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create Sponsorship"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

interface EditFormProps {
  room: BrandedRoom;
  onSave: (data: Partial<{
    brandName: string;
    brandLogoUrl: string | null;
    roomId: string | null;
    sponsorBudgetCoins: number;
    joinBonusCoins: number;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
  }>) => Promise<void>;
  onCancel: () => void;
}

function EditForm({ room, onSave, onCancel }: EditFormProps) {
  const [brandName, setBrandName] = useState(room.brandName);
  const [brandLogoUrl, setBrandLogoUrl] = useState(room.brandLogoUrl ?? "");
  const [roomId, setRoomId] = useState(room.roomId ?? "");
  const [sponsorBudgetCoins, setSponsorBudgetCoins] = useState(room.sponsorBudgetCoins);
  const [joinBonusCoins, setJoinBonusCoins] = useState(room.joinBonusCoins);
  const [isActive, setIsActive] = useState(room.isActive);
  const [startsAt, setStartsAt] = useState(formatDateInput(room.startsAt));
  const [endsAt, setEndsAt] = useState(formatDateInput(room.endsAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        brandName,
        brandLogoUrl: brandLogoUrl.trim() || null,
        roomId: roomId.trim() || null,
        sponsorBudgetCoins,
        joinBonusCoins,
        isActive,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update branded room");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <h3 className="mb-4 text-sm font-bold text-neutral-800 dark:text-neutral-200">
        Edit Sponsorship — {room.brandName}
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Brand Name</label>
          <input
            required
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Brand Logo URL</label>
          <input
            type="url"
            value={brandLogoUrl}
            onChange={(e) => setBrandLogoUrl(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Room ID</label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="UUID of room"
          />
        </div>

        <div className="flex items-center gap-3 pt-5">
          <input
            id="edit-is-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <label htmlFor="edit-is-active" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Active
          </label>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Join Bonus (coins)</label>
          <input
            type="number"
            min={0}
            value={joinBonusCoins}
            onChange={(e) => setJoinBonusCoins(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Sponsor Budget (coins)</label>
          <input
            type="number"
            min={0}
            value={sponsorBudgetCoins}
            onChange={(e) => setSponsorBudgetCoins(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Starts At</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Ends At</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-neutral-200 dark:border-neutral-800">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

interface RoomRowProps {
  room: BrandedRoom;
  onEdit: (room: BrandedRoom) => void;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: string | null;
}

function RoomRow({ room, onEdit, onToggle, onDelete, busy }: RoomRowProps) {
  const isBusy = busy === room.id;
  const status = getRoomStatus(room);

  return (
    <tr className="border-b border-neutral-200 last:border-0 dark:border-neutral-800">
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-2">
          {room.brandLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={room.brandLogoUrl}
              alt={room.brandName}
              className="h-6 w-6 rounded object-contain"
            />
          )}
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {room.brandName}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-neutral-600 dark:text-neutral-400">
        {room.roomName ? (
          <span title={room.roomId ?? undefined}>
            {room.roomName}
            {room.roomType && (
              <span className="ml-1 text-xs text-neutral-400">({room.roomType})</span>
            )}
          </span>
        ) : (
          <span className="text-neutral-400">Unlinked</span>
        )}
      </td>
      <td className="px-3 py-3 text-sm text-neutral-700 dark:text-neutral-300">
        {room.joinBonusCoins.toLocaleString()} coins
      </td>
      <td className="px-3 py-3 text-sm text-neutral-700 dark:text-neutral-300">
        {room.sponsorBudgetCoins.toLocaleString()} coins
      </td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[status]}`}
        >
          {status}
        </span>
      </td>
      <td className="px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">
        {formatDate(room.startsAt)} — {formatDate(room.endsAt)}
      </td>
      <td className="py-3 pl-3 pr-4">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEdit(room)}
            className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
          >
            Edit
          </button>
          <button
            disabled={isBusy}
            onClick={() => onToggle(room.id, !room.isActive)}
            className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {isBusy ? "…" : room.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            disabled={isBusy}
            onClick={() => onDelete(room.id)}
            className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin Branded Rooms management page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminBrandedRoomsPage() {
  const [rooms, setRooms] = useState<BrandedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BrandedRoom | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/branded-rooms", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load branded rooms");
      const data = (await res.json()) as { brandedRooms: BrandedRoom[] };
      setRooms(data.brandedRooms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  async function handleCreate(formData: Parameters<CreateFormProps["onSave"]>[0]) {
    const res = await fetch("/api/admin/branded-rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? "Failed to create sponsorship"
      );
    }
    showToast("Branded room created");
    setCreating(false);
    await fetchRooms();
  }

  async function handleUpdate(id: string, formData: Parameters<EditFormProps["onSave"]>[0]) {
    const res = await fetch(`/api/admin/branded-rooms/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? "Failed to update sponsorship"
      );
    }
    showToast("Branded room updated");
    setEditing(null);
    await fetchRooms();
  }

  async function handleToggle(id: string, isActive: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/branded-rooms/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      showToast(`Sponsorship ${isActive ? "activated" : "deactivated"}`);
      await fetchRooms();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this branded room sponsorship? This cannot be undone.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/branded-rooms/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete branded room");
      showToast("Sponsorship deleted");
      await fetchRooms();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Branded Rooms
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Companies sponsor a dedicated Room. Members who join earn a coin bonus funded by the brand.
            Sponsored rooms appear in discovery with a &quot;Sponsored&quot; tag.
          </p>
        </div>
        {!creating && !editing && (
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + New Branded Room
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Create form */}
      {creating && (
        <CreateForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Edit form */}
      {editing && (
        <EditForm
          room={editing}
          onSave={(data) => handleUpdate(editing.id, data)}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Status legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(STATUS_BADGE) as [RoomStatus, string][]).map(([status, cls]) => (
          <span key={status} className={`rounded-full px-2 py-0.5 font-semibold capitalize ${cls}`}>
            {status}
          </span>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-800">
          <thead>
            <tr className="bg-neutral-50 dark:bg-neutral-800/50">
              <th className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Brand
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Linked Room
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Join Bonus
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Budget
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Status
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Schedule
              </th>
              <th className="py-3 pl-3 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            ) : rooms.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400"
                >
                  No branded rooms yet. Click &quot;New Branded Room&quot; to create a sponsorship.
                </td>
              </tr>
            ) : (
              rooms.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  onEdit={setEditing}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  busy={busy}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
