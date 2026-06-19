"use client";

/**
 * app/(app)/messages/[conversationId]/page.tsx
 *
 * DM conversation page (web version).
 * Shows message feed with polling, plus rich input: text, GIF, stickers, gifts.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { getPidginSuggestions, isPidginLocale } from "@/lib/i18n/pidgin";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useAdaptiveChatPoll } from "@/lib/hooks/useAdaptiveChatPoll";
import { authFetch } from "@/lib/api/authFetch";
import { readCachedMessages, writeCachedMessages } from "@/lib/chat/messageCache";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationInfo {
  conversationId: string;
  participantUserId: string;
  participantUsername: string;
  participantDisplayName: string;
  participantAvatarEmoji: string;
  dmCoinCost?: number | null;
}

interface ConnectionBadge {
  score: number;
  streakDays: number;
  badgeLevel: "bronze" | "silver" | "gold" | "platinum" | null;
  badgeLabel: string | null;
}

interface DMMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarEmoji: string;
  content: string;
  messageType?: "text" | "gif" | "sticker" | "gift";
  giftEmoji?: string;
  giftAmount?: number;
  createdAt: string;
}

interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
}

interface StickerPack {
  id: string;
  name: string;
  coverEmoji: string;
  stickers: Sticker[];
  isUnlocked: boolean;
}

interface Sticker {
  id: string;
  emoji: string;
  name: string;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw DM row (the API returns snake_case columns) into the
 * camelCase `DMMessage` shape the UI renders. Without this, every persisted
 * message showed up as "@undefined" with no avatar and was mis-attributed
 * (isOwn was always false) the moment the 3s poll replaced the optimistic copy.
 * Tolerates already-camelCase input so it is safe to apply everywhere.
 */
function normalizeDM(raw: Record<string, unknown>): DMMessage {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  return {
    id: str(raw.id),
    senderId: str(raw.senderId ?? raw.sender_id),
    senderUsername: str(raw.senderUsername ?? raw.sender_username),
    senderAvatarEmoji: str(raw.senderAvatarEmoji ?? raw.sender_avatar_emoji, "👤"),
    content: str(raw.content ?? raw.media_url ?? raw.mediaUrl),
    messageType: str(raw.messageType ?? raw.message_type, "text") as DMMessage["messageType"],
    giftEmoji: str(raw.giftEmoji ?? raw.gift_emoji) || undefined,
    giftAmount: num(raw.giftAmount ?? raw.gift_amount),
    createdAt: str(raw.createdAt ?? raw.created_at, new Date().toISOString()),
  };
}

/** Extract the first URL from a text string, or null if none. */
function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// LinkPreviewCard — only renders when linkPreviewsEnabled=true (PRD §5)
// ---------------------------------------------------------------------------

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/messages/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: LinkPreviewData | null) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) {
    return (
      <div className="mt-1.5 h-16 w-56 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-700" />
    );
  }
  if (!data?.title) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block max-w-xs overflow-hidden rounded-xl border border-neutral-200 bg-white text-left dark:border-neutral-700 dark:bg-neutral-800"
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.image} alt="" className="h-28 w-full object-cover" loading="lazy" />
      )}
      <div className="p-2.5">
        {data.siteName && (
          <p className="mb-0.5 text-xs text-neutral-400">{data.siteName}</p>
        )}
        <p className="line-clamp-2 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          {data.title}
        </p>
        {data.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{data.description}</p>
        )}
      </div>
    </a>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex animate-pulse gap-2.5 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
          <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className={`space-y-1.5 ${i % 2 === 0 ? "" : "items-end flex flex-col"}`}>
            <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-9 w-48 rounded-2xl bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  isOwn,
  linkPreviewsEnabled,
}: {
  msg: DMMessage;
  isOwn: boolean;
  /** PRD §5: only show link previews after recipient has replied ≥2 times. */
  linkPreviewsEnabled: boolean;
}) {
  const currency = useCurrency();
  const isGif = msg.messageType === "gif";
  const isSticker = msg.messageType === "sticker";
  const isGift = msg.messageType === "gift";
  const firstUrl =
    linkPreviewsEnabled && !isGif && !isSticker && !isGift && msg.content
      ? extractFirstUrl(msg.content)
      : null;

  return (
    <div className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <span className="mt-1 h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-center text-lg leading-8 dark:bg-neutral-800">
        {msg.senderAvatarEmoji}
      </span>
      <div className={`flex min-w-0 max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <span className="max-w-[40vw] truncate text-xs font-semibold text-blue-600 dark:text-blue-400">
              @{msg.senderUsername}
            </span>
          )}
          <span className="text-xs text-neutral-400">{timeAgo(msg.createdAt)}</span>
        </div>

        {isGif ? (
          <div className="mt-0.5 overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={msg.content}
              alt="GIF"
              className="max-h-48 max-w-xs rounded-2xl object-cover"
              loading="lazy"
            />
          </div>
        ) : isSticker ? (
          <div className="mt-0.5 flex items-center justify-center rounded-2xl bg-neutral-50 p-4 text-5xl dark:bg-neutral-800/50">
            {msg.content}
          </div>
        ) : isGift ? (
          <div className="mt-0.5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
            <span className="text-2xl">{msg.giftEmoji ?? "🎁"}</span>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{msg.content}</p>
              {msg.giftAmount && (
                <p className="text-xs text-amber-600 dark:text-amber-400">🪙 {msg.giftAmount.toLocaleString()} {currency.softPlural.toLowerCase()}</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              className={`mt-0.5 overflow-hidden whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                isOwn
                  ? "rounded-tr-sm bg-blue-600 text-white"
                  : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              }`}
            >
              {msg.content}
            </div>
            {/* PRD §5: link preview — only when recipient has replied ≥2 times */}
            {firstUrl && <LinkPreviewCard url={firstUrl} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GIF Picker Panel
// ---------------------------------------------------------------------------

function GifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/gif?q=${encodeURIComponent(q)}&limit=12`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { gifs?: GifResult[] };
      setResults(data.gifs ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  // Load trending GIFs on mount
  useEffect(() => { void search("trending"); }, [search]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">GIFs</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close GIF picker">✕</button>
      </div>
      <div className="p-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs…"
          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          autoFocus
        />
      </div>
      <div className="grid max-h-52 grid-cols-3 gap-1 overflow-y-auto p-2">
        {loading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700" />
          ))
        ) : results.length === 0 ? (
          <div className="col-span-3 py-6 text-center text-xs text-neutral-400">
            {query ? "No GIFs found" : "Type to search GIFs"}
          </div>
        ) : (
          results.map((gif) => (
            <button
              key={gif.id}
              onClick={() => onSelect(gif.url)}
              className="aspect-square overflow-hidden rounded-lg hover:opacity-80"
              title={gif.title}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gif.previewUrl || gif.url} alt={gif.title} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticker Picker Panel
// ---------------------------------------------------------------------------

function StickerPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stickers", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json() as { data?: { packs?: Array<Record<string, unknown>> }; packs?: Array<Record<string, unknown>> };
        const rows = json.data?.packs ?? json.packs ?? [];
        const unlockedPacks: StickerPack[] = rows
          .filter((r) => r.unlocked ?? r.isUnlocked)
          .map((r) => ({
            id: r.id as string,
            name: r.name as string,
            coverEmoji: (r.cover_sticker_url ?? r.coverEmoji ?? "🎨") as string,
            stickers: (r.stickers ?? []) as Sticker[],
            isUnlocked: true,
          }));
        setPacks(unlockedPacks);
        if (unlockedPacks.length > 0) setActivePack(unlockedPacks[0].id);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentPack = packs.find((p) => p.id === activePack);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">Stickers</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close sticker picker">✕</button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : packs.length === 0 ? (
        <div className="p-4 text-center">
          <p className="text-xs text-neutral-500">No sticker packs unlocked yet.</p>
          <Link href="/stickers" className="mt-1 block text-xs font-semibold text-blue-600 hover:underline">
            Browse Stickers →
          </Link>
        </div>
      ) : (
        <>
          {/* Pack tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 p-1.5 dark:border-neutral-700">
            {packs.map((pack) => (
              <button
                key={pack.id}
                onClick={() => setActivePack(pack.id)}
                title={pack.name}
                className={`shrink-0 rounded-lg px-2 py-1 text-lg transition-colors ${
                  activePack === pack.id
                    ? "bg-blue-100 dark:bg-blue-900"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {pack.coverEmoji}
              </button>
            ))}
          </div>
          {/* Stickers grid */}
          <div className="grid max-h-44 grid-cols-4 gap-1 overflow-y-auto p-2">
            {(currentPack?.stickers ?? []).map((sticker) => (
              <button
                key={sticker.id}
                onClick={() => onSelect(sticker.emoji)}
                title={sticker.name}
                className="flex aspect-square items-center justify-center rounded-lg text-3xl hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {sticker.emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gift Picker Panel
// ---------------------------------------------------------------------------

function GiftPicker({
  conversationId,
  recipientUsername,
  onSent,
  onClose,
}: {
  conversationId: string;
  recipientUsername: string;
  onSent: (giftName: string, giftEmoji: string, coinValue: number) => void;
  onClose: () => void;
}) {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/economy/gifts/catalogue", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { gifts?: GiftItem[] };
        setGifts(data.gifts ?? []);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSend(gift: GiftItem) {
    setSending(gift.id);
    setError(null);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giftItemId: gift.id,
          context: "dm",
          conversationId,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: { code?: string; message?: string } };
        const code = d.error?.code ?? null;
        const message = d.error?.message ?? d.message ?? "Failed to send gift";
        const err = new Error(message) as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
      onSent(gift.name, gift.emoji, gift.coinCost);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to send gift") : "Failed to send gift");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">Send a Gift to @{recipientUsername}</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close gift picker">✕</button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto p-2">
          {gifts.map((gift) => (
            <button
              key={gift.id}
              onClick={() => void handleSend(gift)}
              disabled={sending === gift.id}
              className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-neutral-800"
            >
              <span className="text-3xl">{gift.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{gift.name}</p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                🪙 {gift.coinCost.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DMConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.conversationId as string;
  const currency = useCurrency();
  const { t } = useTranslation();

  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>(
    () => readCachedMessages<DMMessage>(`dm:${conversationId}`) ?? []
  );
  const [loadingConversation, setLoadingConversation] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(
    () => (readCachedMessages<DMMessage>(`dm:${conversationId}`)?.length ?? 0) === 0
  );
  const [error, setError] = useState<string | null>(null);
  const [coinError, setCoinError] = useState<{ message: string; balance?: number; required?: number } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connectionBadge, setConnectionBadge] = useState<ConnectionBadge | null>(null);
  // PRD §3: "Gift them coins" — shown when recipient cannot afford to reply
  const [recipientCanReply, setRecipientCanReply] = useState(true);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  // PRD §5: link previews only shown after recipient has replied at least twice
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(false);
  // PRD §5 — Conversation Score
  const [convScore, setConvScore] = useState<number>(0);
  // PRD §5 — Pidgin autocomplete (Nigerian locales)
  const [pidginSuggestions, setPidginSuggestions] = useState<string[]>([]);
  const [userLocale, setUserLocale] = useState<string>("");

  // Rich input panel state
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showGiftPicker, setShowGiftPicker] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Prevent body scroll on iOS PWA so touch events reach the feed container.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  // Persist latest messages for instant first paint on reopen.
  useEffect(() => {
    if (messages.length) writeCachedMessages(`dm:${conversationId}`, messages);
  }, [messages, conversationId]);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { id: string; locale?: string }) => {
        setCurrentUserId(d.id);
        if (d.locale) setUserLocale(d.locale);
      })
      .catch(() => {});
    // Fall back to browser locale for Pidgin detection
    setUserLocale((prev) => prev || navigator.language || "");
  }, []);

  useEffect(() => {
    // The messages endpoint now returns conversation metadata too — one fetch does both
    (async () => {
      try {
        const res = await fetch(`/api/messages/dm/${conversationId}`, { credentials: "include" });
        if (res.status === 401) { router.push("/auth/login"); return; }
        if (!res.ok) throw new Error("Conversation not found");
        const data = (await res.json()) as {
          conversation?: ConversationInfo & { score?: number };
          items?: Record<string, unknown>[];
          recipientCanReply?: boolean;
          otherUserId?: string;
          linkPreviewsEnabled?: boolean;
        };
        if (data.conversation) {
          setConversation(data.conversation);
          if (typeof data.conversation.score === "number") setConvScore(data.conversation.score);
        }
        if (data.items) setMessages(data.items.map(normalizeDM));
        if (typeof data.recipientCanReply === "boolean") setRecipientCanReply(data.recipientCanReply);
        if (data.otherUserId) setOtherUserId(data.otherUserId);
        // PRD §5: gate link previews until recipient has replied ≥2 times
        if (typeof data.linkPreviewsEnabled === "boolean") setLinkPreviewsEnabled(data.linkPreviewsEnabled);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error loading conversation");
      } finally {
        setLoadingConversation(false);
        setLoadingMessages(false);
      }
    })();
  }, [conversationId, router]);

  const fetchConnectionBadge = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/dm/${conversationId}/connection-badge`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { badge?: ConnectionBadge; data?: ConnectionBadge; score?: number };
      const badge = data.badge ?? data.data ?? null;
      if (badge) {
        setConnectionBadge(badge);
        if (typeof badge.score === "number") setConvScore(badge.score);
      }
      if (typeof data.score === "number") setConvScore(data.score);
    } catch { /* non-fatal */ }
  }, [conversationId]);

  // Fetch conversation score separately (in case not included in conversation payload)
  const fetchConvScore = useCallback(async () => {
    if (!conversation) return;
    try {
      const res = await fetch(
        `/api/messages/dm?other=${conversation.participantUserId}&score=true`,
        { credentials: "include" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { score?: number; convScore?: number };
      const s = data.score ?? data.convScore ?? 0;
      if (typeof s === "number" && s > 0) setConvScore(s);
    } catch { /* non-fatal */ }
  }, [conversation]);

  useEffect(() => { void fetchConnectionBadge(); }, [fetchConnectionBadge]);
  useEffect(() => { void fetchConvScore(); }, [fetchConvScore]);

  // Newest message timestamp seen — drives delta polling (?after=).
  const latestCreatedAtRef = useRef<string | undefined>(undefined);

  // Merge incoming DMs into state, deduping by id and keeping chronological
  // order. Shared by the initial load, the delta poll, and the realtime push.
  const mergeIncoming = useCallback((incoming: DMMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = prev.slice();
      for (const m of incoming) {
        if (m && m.id && !seen.has(m.id)) { merged.push(m); seen.add(m.id); }
      }
      merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      latestCreatedAtRef.current = merged[merged.length - 1]?.createdAt;
      return merged;
    });
  }, []);

  const fetchMessages = useCallback(async (): Promise<boolean> => {
    try {
      // Delta fetch after the first load — only messages newer than the latest.
      // The conversation-level GET still returns recipientCanReply/otherUserId/meta.
      const after = latestCreatedAtRef.current;
      const url = after
        ? `/api/messages/dm/${conversationId}?after=${encodeURIComponent(after)}`
        : `/api/messages/dm/${conversationId}`;
      // authFetch silently refreshes on 401 and raises the app-wide "signed out"
      // notice if the session is truly gone.
      const res = await authFetch(url);
      if (!res.ok) return false;
      const data = (await res.json()) as {
        messages?: Record<string, unknown>[];
        items?: Record<string, unknown>[];
        conversation?: ConversationInfo;
        recipientCanReply?: boolean;
        otherUserId?: string;
      };
      const incoming = (data.messages ?? data.items ?? []).map(normalizeDM);
      mergeIncoming(incoming);
      // Populate conversation info if this response includes it
      if (data.conversation) setConversation(data.conversation);
      // PRD §3: surface when recipient cannot afford to reply
      if (typeof data.recipientCanReply === "boolean") {
        setRecipientCanReply(data.recipientCanReply);
      }
      if (data.otherUserId) setOtherUserId(data.otherUserId);
      // Activity signal drives the poll's idle backoff.
      return incoming.length > 0;
    } catch { /* ignore */ return false; } finally {
      setLoadingMessages(false);
    }
  }, [conversationId, mergeIncoming]);

  // Realtime push — delivers new messages instantly via Ably / Pusher /
  // Supabase Realtime. Supplements the baseline poll; doesn't replace it.
  const realtimeConnected = useRealtimeChannel(
    conversationId ? `dm:conversation:${conversationId}` : null,
    useCallback((event: string, data: unknown) => {
      if (event === "new_message") {
        const { message } = (data as { message?: Record<string, unknown> }) ?? {};
        if (message) mergeIncoming([normalizeDM(message)]);
      }
    }, [mergeIncoming])
  );

  // Baseline poll — fast (3s) when realtime is down / unconfigured, slow
  // reconcile (30s) when the socket is connected, paused while the tab is
  // hidden. Keeps serverless usage low while guaranteeing delivery.
  const { pokePoll } = useAdaptiveChatPoll({
    poll: fetchMessages,
    connected: realtimeConnected,
    enabled: !!conversationId,
  });

  // Close pickers when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-picker]")) {
        setShowGifPicker(false);
        setShowStickerPicker(false);
        setShowGiftPicker(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function sendMessage(content: string, messageType: "text" | "gif" | "sticker" = "text") {
    if (!content.trim() || sending) return;
    setSending(true);
    setCoinError(null);
    // Optimistic update — show message immediately, reconcile after server confirms
    const optimisticId = `opt_${Date.now()}_${Math.random()}`;
    const optimisticMsg: DMMessage = {
      id: optimisticId,
      senderId: currentUserId ?? "me",
      senderUsername: "you",
      senderAvatarEmoji: "💬",
      content: content.trim(),
      messageType,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");
    try {
      const res = await authFetch(`/api/messages/dm/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), messageType }),
      });
      if (!res.ok) {
        // Roll back optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const d = (await res.json()) as { message?: string; error?: { code?: string; coinBalance?: number; coinCost?: number } };
        const code = d.error?.code;
        if (code === "INSUFFICIENT_COINS") {
          setCoinError({
            message: `You need ${d.error?.coinCost ?? "?"} ${currency.softPlural.toLowerCase()} to send this message. You currently have ${d.error?.coinBalance ?? "?"} ${currency.softPlural.toLowerCase()}.`,
            balance: d.error?.coinBalance,
            required: d.error?.coinCost,
          });
          return;
        }
        if (code === "PLAN_RESTRICTION") {
          setCoinError({ message: "Upgrade to Pro to start new conversations." });
          return;
        }
        const err = new Error(d.message ?? "Failed to send") as Error & { code?: string | null };
        err.code = code ?? null;
        throw err;
      }
      const responseData = (await res.json()) as { message?: Record<string, unknown>; messages?: Record<string, unknown>[] };
      // Replace optimistic message with the real one from the server
      if (responseData.message) {
        const real = normalizeDM(responseData.message);
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? real : m))
        );
      } else {
        // Server didn't return the message — remove optimistic and refetch
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        await fetchMessages();
      }
      void fetchConnectionBadge();
      // Snap the poll back to fast cadence so a reply is picked up promptly.
      pokePoll();
    } catch (e) {
      // Roll back optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to send") : "Failed to send");
      setTimeout(() => setError(null), 3000);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleInputChange(value: string) {
    setInput(value);
    if (isPidginLocale(userLocale)) {
      setPidginSuggestions(getPidginSuggestions(value));
    }
  }

  function handlePidginSuggestion(suggestion: string) {
    const words = input.split(" ");
    words[words.length - 1] = suggestion;
    setInput(words.join(" "));
    setPidginSuggestions([]);
    inputRef.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPidginSuggestions([]);
    await sendMessage(input);
  }

  function handleGifSelect(url: string) {
    setShowGifPicker(false);
    void sendMessage(url, "gif");
  }

  function handleStickerSelect(emoji: string) {
    setShowStickerPicker(false);
    void sendMessage(emoji, "sticker");
  }

  function handleGiftSent(giftName: string, giftEmoji: string, coinValue: number) {
    setShowGiftPicker(false);
    // Optimistically add gift message to feed
    const optimistic: DMMessage = {
      id: `opt_${Date.now()}`,
      senderId: currentUserId ?? "",
      senderUsername: "you",
      senderAvatarEmoji: "🎁",
      content: giftName,
      messageType: "gift",
      giftEmoji,
      giftAmount: coinValue,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    // Re-fetch to get the real server record
    setTimeout(() => { void fetchMessages(); }, 1000);
  }

  if (loadingConversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error}</p>
        <Link href="/messages" className="text-sm text-blue-600 hover:underline">
          Back to Messages
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          href="/messages"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Back to messages"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {conversation && (
          <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
              {conversation.participantAvatarEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-50">
                  {conversation.participantDisplayName || `@${conversation.participantUsername}`}
                </p>
                {connectionBadge?.badgeLabel && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      connectionBadge.badgeLevel === "platinum"
                        ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200"
                        : connectionBadge.badgeLevel === "gold"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                        : connectionBadge.badgeLevel === "silver"
                        ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200"
                    }`}
                    title={`Connection score: ${connectionBadge.score} · ${connectionBadge.streakDays}-day streak`}
                  >
                    🔗 {connectionBadge.badgeLabel}
                  </span>
                )}
                {/* Conversation Score — PRD §5 */}
                {convScore > 0 && (
                  <div
                    className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    title="Conversation Score — builds as you message daily"
                  >
                    <span>💬</span>
                    <span>{convScore} pts</span>
                    {convScore >= 250 && <span className="ml-1">🏆</span>}
                    {convScore >= 100 && convScore < 250 && <span className="ml-1">⭐</span>}
                    {convScore >= 50 && convScore < 100 && <span className="ml-1">🔵</span>}
                  </div>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                @{conversation.participantUsername}
                {connectionBadge && connectionBadge.streakDays > 0 && (
                  <span className="ml-2 text-teal-500">{connectionBadge.streakDays}-day streak</span>
                )}
              </p>
            </div>
          </>
        )}
      </div>

      {/* DM coin cost notice */}
      {conversation?.dmCoinCost && conversation.dmCoinCost > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Sending a message costs <span className="font-semibold">{conversation.dmCoinCost} {currency.softPlural.toLowerCase()}</span> per message.
          </p>
        </div>
      )}

      {/* Error toast */}
      {error && conversation && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-950">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Coin error banner */}
      {coinError && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs text-amber-800 dark:text-amber-300">{coinError.message}</p>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/wallet?buy=true"
              onClick={() => setCoinError(null)}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              Buy {currency.softPlural}
            </Link>
            <button onClick={() => setCoinError(null)} className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400">✕</button>
          </div>
        </div>
      )}

      {/* PRD §3: "Gift them coins" — recipient cannot afford to reply */}
      {!recipientCanReply && otherUserId && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This person cannot reply right now — they may not have enough {currency.softPlural.toLowerCase()}.
          </p>
          <Link
            href={`/wallet?transfer=${otherUserId}`}
            className="ml-3 shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
          >
            🪙 Gift them {currency.softPlural.toLowerCase()}
          </Link>
        </div>
      )}

      {/* Message feed */}
      <div
        ref={feedRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
        aria-live="polite"
        aria-label="Direct messages"
      >
        {loadingMessages ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <span className="text-4xl">💬</span>
            <p className="mt-2 text-sm">No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.senderId === currentUserId}
              linkPreviewsEnabled={linkPreviewsEnabled}
            />
          ))
        )}
      </div>

      {/* Input bar with rich media pickers */}
      <div
        data-picker="root"
        className="relative border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      >
        {/* GIF Picker */}
        {showGifPicker && (
          <div data-picker="gif">
            <GifPicker
              onSelect={handleGifSelect}
              onClose={() => setShowGifPicker(false)}
            />
          </div>
        )}

        {/* Sticker Picker */}
        {showStickerPicker && (
          <div data-picker="sticker">
            <StickerPicker
              onSelect={handleStickerSelect}
              onClose={() => setShowStickerPicker(false)}
            />
          </div>
        )}

        {/* Gift Picker */}
        {showGiftPicker && conversation && (
          <div data-picker="gift">
            <GiftPicker
              conversationId={conversationId}
              recipientUsername={conversation.participantUsername}
              onSent={handleGiftSent}
              onClose={() => setShowGiftPicker(false)}
            />
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative flex items-center gap-1.5 p-3">
          {/* GIF button */}
          <button
            type="button"
            data-picker="gif-btn"
            onClick={() => {
              setShowGifPicker((v) => !v);
              setShowStickerPicker(false);
              setShowGiftPicker(false);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold transition-colors ${
              showGifPicker
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            }`}
            aria-label="Search GIFs"
            title="GIF"
          >
            GIF
          </button>

          {/* Sticker button */}
          <button
            type="button"
            data-picker="sticker-btn"
            onClick={() => {
              setShowStickerPicker((v) => !v);
              setShowGifPicker(false);
              setShowGiftPicker(false);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${
              showStickerPicker
                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200"
                : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
            aria-label="Stickers"
            title="Stickers"
          >
            😊
          </button>

          {/* Pidgin autocomplete suggestions — PRD §5 */}
          {pidginSuggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 flex gap-1.5 px-3 pb-1">
              {pidginSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handlePidginSuggestion(s)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Type a message…"
            maxLength={1000}
            className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          />

          {/* Gift button */}
          <button
            type="button"
            data-picker="gift-btn"
            onClick={() => {
              setShowGiftPicker((v) => !v);
              setShowGifPicker(false);
              setShowStickerPicker(false);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${
              showGiftPicker
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                : "text-neutral-400 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30"
            }`}
            aria-label="Send a gift"
            title="Send Gift"
          >
            🎁
          </button>

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
