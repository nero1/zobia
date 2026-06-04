"use client";

/**
 * app/(app)/rooms/create/page.tsx
 *
 * Web room creation page with ClassRoom curriculum builder.
 * Supports all 6 room types per PRD §10:
 *   free_open, vip, drop, tipping, classroom, guild
 *
 * For classroom type: curriculum builder (add/remove/reorder modules,
 * enrolment fee, start/end dates, graduation ceremony toggle).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomType = "free_open" | "vip" | "drop" | "tipping" | "classroom" | "guild";

interface CurriculumModule {
  id: string;
  title: string;
  description: string;
}

interface CreateRoomPayload {
  name: string;
  description: string;
  roomType: RoomType;
  category: string;
  coverEmoji: string;
  priceCoin?: number;
  entryFeeCoin?: number;
  dropDurationHours?: number;
  // ClassRoom-specific
  curriculumTitle?: string;
  modules?: CurriculumModule[];
  startDate?: string;
  endDate?: string;
  hasGraduation?: boolean;
  enrolmentFee?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOM_TYPE_OPTIONS: Array<{
  type: RoomType;
  label: string;
  emoji: string;
  description: string;
  borderColor: string;
}> = [
  { type: "free_open", label: "Free & Open", emoji: "🌐", description: "Discoverable by all. Free to join. Earn through gifts.", borderColor: "border-blue-500" },
  { type: "vip", label: "VIP", emoji: "👑", description: "Gated by monthly subscription. Set your price.", borderColor: "border-amber-500" },
  { type: "drop", label: "Drop", emoji: "⚡", description: "Limited-time event room with entry fee. High FOMO.", borderColor: "border-orange-500" },
  { type: "tipping", label: "Tipping", emoji: "🎙️", description: "Free to join. Earn entirely through gifts and tips.", borderColor: "border-teal-500" },
  { type: "classroom", label: "ClassRoom", emoji: "📚", description: "Structured learning with curriculum and one-time enrolment fee.", borderColor: "border-teal-600" },
  { type: "guild", label: "Guild Room", emoji: "🤝", description: "Private room for Guild members only (Platinum tier+).", borderColor: "border-green-500" },
];

const CATEGORIES = [
  "Tech", "Music", "Gaming", "Sports", "Arts", "Business",
  "Health", "Education", "Faith", "Entertainment", "Other",
];

const COVER_EMOJIS = ["🌐", "🎙️", "📚", "🎮", "🏆", "💡", "🎵", "⚽", "🔥", "💼", "🤝", "👑", "⚡", "🌍"];

// ---------------------------------------------------------------------------
// Curriculum builder sub-component
// ---------------------------------------------------------------------------

function CurriculumBuilder({
  modules,
  onChange,
}: {
  modules: CurriculumModule[];
  onChange: (m: CurriculumModule[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  function addModule() {
    if (!title.trim()) return;
    onChange([
      ...modules,
      { id: Date.now().toString(), title: title.trim(), description: desc.trim() },
    ]);
    setTitle("");
    setDesc("");
  }

  function removeModule(id: string) {
    onChange(modules.filter((m) => m.id !== id));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...modules];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index === modules.length - 1) return;
    const next = [...modules];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* Module list */}
      {modules.length > 0 && (
        <div className="space-y-2">
          {modules.map((m, i) => (
            <div
              key={m.id}
              className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/20"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="text-xs text-neutral-400 disabled:opacity-20 hover:text-neutral-600"
                  aria-label="Move module up"
                >▲</button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === modules.length - 1}
                  className="text-xs text-neutral-400 disabled:opacity-20 hover:text-neutral-600"
                  aria-label="Move module down"
                >▼</button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Module {i + 1}: {m.title}
                </p>
                {m.description && (
                  <p className="mt-0.5 text-xs text-neutral-500">{m.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeModule(m.id)}
                className="text-xs text-red-500 hover:text-red-700"
                aria-label="Remove module"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add module form */}
      <div className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Add Module</p>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Module title (e.g. Week 1: Foundations)"
          maxLength={100}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Short description (optional)"
          maxLength={200}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="button"
          onClick={addModule}
          disabled={!title.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-teal-700"
        >
          + Add Module
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CreateRoomPage() {
  const router = useRouter();

  // Form state
  const [step, setStep] = useState<"type" | "details" | "preview">("type");
  const [roomType, setRoomType] = useState<RoomType>("free_open");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [coverEmoji, setCoverEmoji] = useState("🌐");
  const [priceCoin, setPriceCoin] = useState("");
  const [entryFeeCoin, setEntryFeeCoin] = useState("");
  const [dropDurationHours, setDropDurationHours] = useState("2");
  // ClassRoom-specific
  const [curriculumTitle, setCurriculumTitle] = useState("");
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasGraduation, setHasGraduation] = useState(false);
  const [enrolmentFee, setEnrolmentFee] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = ROOM_TYPE_OPTIONS.find((t) => t.type === roomType)!;

  async function handleSubmit() {
    if (!name.trim()) { setError("Room name is required"); return; }
    if (roomType === "classroom" && modules.length === 0) {
      setError("Add at least one curriculum module"); return;
    }

    setSubmitting(true);
    setError(null);

    const payload: CreateRoomPayload = {
      name: name.trim(),
      description: description.trim(),
      roomType,
      category,
      coverEmoji,
    };

    if (roomType === "vip" && priceCoin) payload.priceCoin = parseInt(priceCoin, 10);
    if (roomType === "drop") {
      if (entryFeeCoin) payload.entryFeeCoin = parseInt(entryFeeCoin, 10);
      payload.dropDurationHours = parseInt(dropDurationHours, 10);
    }
    if (roomType === "classroom") {
      payload.curriculumTitle = curriculumTitle.trim();
      payload.modules = modules;
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      payload.hasGraduation = hasGraduation;
      if (enrolmentFee) payload.enrolmentFee = parseInt(enrolmentFee, 10);
    }

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string };
        throw new Error(d.message ?? d.error ?? "Failed to create room");
      }
      const data = (await res.json()) as { room?: { id: string }; id?: string };
      const roomId = data.room?.id ?? data.id;
      if (roomId) {
        router.push(`/rooms/${roomId}`);
      } else {
        router.push("/rooms");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Create Room</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400">
        {(["type", "details", "preview"] as const).map((s, i) => (
          <span key={s} className={`capitalize ${step === s ? "text-blue-600 dark:text-blue-400" : ""}`}>
            {i + 1}. {s === "type" ? "Room Type" : s === "details" ? "Details" : "Preview"}
            {i < 2 && <span className="mx-2">→</span>}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Step 1: Room type */}
      {step === "type" && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-500">Choose the type of room you want to create.</p>
          <div className="space-y-3">
            {ROOM_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => { setRoomType(opt.type); setCoverEmoji(opt.emoji); }}
                className={`flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left transition-colors ${
                  roomType === opt.type
                    ? `${opt.borderColor} bg-blue-50 dark:bg-blue-950/20`
                    : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800"
                }`}
              >
                <span className="text-3xl">{opt.emoji}</span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{opt.description}</p>
                </div>
                {roomType === opt.type && (
                  <span className="text-sm text-blue-600">✓</span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep("details")}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Continue →
          </button>
        </div>
      )}

      {/* Step 2: Details */}
      {step === "details" && (
        <div className="space-y-5">
          {/* Cover emoji */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Cover Emoji
            </label>
            <div className="flex flex-wrap gap-2">
              {COVER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setCoverEmoji(e)}
                  className={`h-10 w-10 rounded-xl border-2 text-xl ${coverEmoji === e ? "border-blue-500 bg-blue-50" : "border-neutral-200 hover:border-neutral-400"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="room-name">
              Room Name *
            </label>
            <input
              id="room-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${selectedType.emoji} My ${selectedType.label} Room`}
              maxLength={80}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="room-desc">
              Description
            </label>
            <textarea
              id="room-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what this room is about…"
              maxLength={300}
              rows={3}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {/* Category */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    category === c
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* VIP: subscription price */}
          {roomType === "vip" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="vip-price">
                Monthly Subscription Price (Coins)
              </label>
              <input
                id="vip-price"
                type="number"
                min={200}
                max={10000}
                value={priceCoin}
                onChange={(e) => setPriceCoin(e.target.value)}
                placeholder="e.g. 500"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <p className="mt-1 text-xs text-neutral-400">Min 200 · Max 10,000 coins</p>
            </div>
          )}

          {/* Drop: entry fee + duration */}
          {roomType === "drop" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="entry-fee">
                  Entry Fee (Coins)
                </label>
                <input
                  id="entry-fee"
                  type="number"
                  min={0}
                  value={entryFeeCoin}
                  onChange={(e) => setEntryFeeCoin(e.target.value)}
                  placeholder="0 = free entry"
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="drop-duration">
                  Room Duration (hours)
                </label>
                <select
                  id="drop-duration"
                  value={dropDurationHours}
                  onChange={(e) => setDropDurationHours(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  {["1", "2", "3", "4", "6", "12", "24"].map((h) => (
                    <option key={h} value={h}>{h} hour{h !== "1" ? "s" : ""}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ClassRoom: full curriculum builder */}
          {roomType === "classroom" && (
            <div className="space-y-5 rounded-2xl border-2 border-teal-200 bg-teal-50/50 p-5 dark:border-teal-800 dark:bg-teal-950/20">
              <h3 className="text-sm font-bold text-teal-800 dark:text-teal-200">📚 Curriculum Builder</h3>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="curriculum-title">
                  Curriculum Title *
                </label>
                <input
                  id="curriculum-title"
                  type="text"
                  value={curriculumTitle}
                  onChange={(e) => setCurriculumTitle(e.target.value)}
                  placeholder="e.g. 8-Week Music Production Bootcamp"
                  maxLength={100}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="start-date">
                    Start Date
                  </label>
                  <input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="end-date">
                    End Date
                  </label>
                  <input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500" htmlFor="enrolment-fee">
                  Enrolment Fee (Coins)
                </label>
                <input
                  id="enrolment-fee"
                  type="number"
                  min={0}
                  value={enrolmentFee}
                  onChange={(e) => setEnrolmentFee(e.target.value)}
                  placeholder="0 = free enrolment"
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={hasGraduation}
                  onChange={(e) => setHasGraduation(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500"
                />
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Graduation Ceremony</p>
                  <p className="text-xs text-neutral-500">Host a final session for graduates. Zobia Learning Certificates issued after graduation.</p>
                </div>
              </label>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Curriculum Modules ({modules.length})
                </p>
                <CurriculumBuilder modules={modules} onChange={setModules} />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("type")}
              className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (!name.trim()) { setError("Room name is required"); return; }
                setError(null);
                setStep("preview");
              }}
              className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Preview →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && (
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-4xl">{coverEmoji}</span>
              <div>
                <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{name}</h2>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold capitalize dark:bg-neutral-800">
                    {roomType.replace("_", " ")}
                  </span>
                  <span>{category}</span>
                </div>
              </div>
            </div>

            {description && (
              <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
            )}

            {roomType === "vip" && priceCoin && (
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                👑 {parseInt(priceCoin, 10).toLocaleString()} coins/month
              </p>
            )}

            {roomType === "drop" && (
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
                ⚡ {entryFeeCoin ? `${parseInt(entryFeeCoin, 10).toLocaleString()} coins entry` : "Free entry"} · {dropDurationHours}h duration
              </p>
            )}

            {roomType === "classroom" && (
              <div className="mt-3 space-y-2">
                {curriculumTitle && (
                  <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">
                    📚 {curriculumTitle}
                  </p>
                )}
                {modules.length > 0 && (
                  <div className="space-y-1">
                    {modules.map((m, i) => (
                      <p key={m.id} className="text-xs text-neutral-500">
                        Module {i + 1}: {m.title}
                      </p>
                    ))}
                  </div>
                )}
                {startDate && endDate && (
                  <p className="text-xs text-neutral-500">
                    {new Date(startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {" – "}
                    {new Date(endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
                {hasGraduation && (
                  <p className="text-xs font-semibold text-teal-600">🎓 Graduation ceremony included</p>
                )}
                {enrolmentFee && (
                  <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">
                    Enrolment: {parseInt(enrolmentFee, 10).toLocaleString()} coins
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("details")}
              className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              ← Edit
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Creating…" : "🚀 Create Room"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
