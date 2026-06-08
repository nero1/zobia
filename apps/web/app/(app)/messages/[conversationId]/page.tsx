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
import { getPidginSuggestions, isPidginLocale } from "@/lib/i18n/pidgin";

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
  coinPrice: number;
  tier: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      <div className={`max-w-[75%] flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
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
                <p className="text-xs text-amber-600 dark:text-amber-400">🪙 {msg.giftAmount.toLocaleString()} coins</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              className={`mt-0.5 rounded-2xl px-3.5 py-2 text-sm ${
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
    <div className="absolute bottom-full left-0 z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
        const data = (await res.json()) as { packs?: StickerPack[] };
        const unlockedPacks = (data.packs ?? []).filter((p) => p.isUnlocked);
        setPacks(unlockedPacks);
        if (unlockedPacks.length > 0) setActivePack(unlockedPacks[0].id);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentPack = packs.find((p) => p.id === activePack);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? "Failed to send gift");
      }
      onSent(gift.name, gift.emoji, gift.coinPrice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send gift");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
                🪙 {gift.coinPrice.toLocaleString()}
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

  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const sseRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

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
        if (res.status === 401) { router.push("/login"); return; }
        if (!res.ok) throw new Error("Conversation not found");
        const data = (await res.json()) as {
          conversation?: ConversationInfo & { score?: number };
          items?: DMMessage[];
          recipientCanReply?: boolean;
          otherUserId?: string;
          linkPreviewsEnabled?: boolean;
        };
        if (data.conversation) {
          setConversation(data.conversation);
          if (typeof data.conversation.score === "number") setConvScore(data.conversation.score);
        }
        if (data.items) setMessages(data.items);
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

  const fetchMessages = useCallback(async () => {
    try {
      // Note: the conversation-level GET returns items + recipientCanReply + otherUserId
      const res = await fetch(`/api/messages/dm/${conversationId}`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: DMMessage[];
        items?: DMMessage[];
        conversation?: ConversationInfo;
        recipientCanReply?: boolean;
        otherUserId?: string;
      };
      setMessages(data.messages ?? data.items ?? []);
      // Populate conversation info if this response includes it
      if (data.conversation) setConversation(data.conversation);
      // PRD §3: surface when recipient cannot afford to reply
      if (typeof data.recipientCanReply === "boolean") {
        setRecipientCanReply(data.recipientCanReply);
      }
      if (data.otherUserId) setOtherUserId(data.otherUserId);
    } catch { /* ignore */ } finally {
      setLoadingMessages(false);
    }
  }, [conversationId]);

  // Realtime: open an SSE connection for instant message delivery.
  // Falls back to 5-second polling if SSE is unavailable.
  useEffect(() => {
    // Initial load
    void fetchMessages();

    if (!conversationId || typeof EventSource === "undefined") {
      pollRef.current = setInterval(fetchMessages, 5_000);
      return () => clearInterval(pollRef.current);
    }

    let sseConnected = false;
    const es = new EventSource(
      `/api/realtime/sse?channel=dm:conversation:${conversationId}`,
      { withCredentials: true }
    );
    sseRef.current = es;

    es.onopen = () => {
      sseConnected = true;
      // Cancel fallback polling now that SSE is live
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
    };

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const { event, data } = JSON.parse(e.data) as {
          event: string;
          data: { message: DMMessage };
        };
        if (event === "new_message" && data?.message) {
          setMessages((prev) => {
            const alreadyExists = prev.some((m) => m.id === data.message.id);
            return alreadyExists ? prev : [...prev, data.message];
          });
        }
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      if (!sseConnected) {
        // SSE never connected — start fallback polling
        es.close();
        sseRef.current = null;
        if (!pollRef.current) {
          pollRef.current = setInterval(fetchMessages, 5_000);
        }
      }
      // If SSE was connected and then errored, the browser retries automatically.
    };

    // Start a slow fallback poll in case SSE connection takes too long
    const fallbackTimeout = setTimeout(() => {
      if (!sseConnected && !pollRef.current) {
        pollRef.current = setInterval(fetchMessages, 5_000);
      }
    }, 3_000);

    return () => {
      clearTimeout(fallbackTimeout);
      clearInterval(pollRef.current);
      pollRef.current = undefined;
      es.close();
      sseRef.current = null;
    };
  }, [conversationId, fetchMessages]);

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
    try {
      const res = await fetch(`/api/messages/dm/${conversationId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), messageType }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? "Failed to send");
      }
      setInput("");
      await fetchMessages();
      void fetchConnectionBadge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
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
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !conversation) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error}</p>
        <Link href="/messages" className="text-sm text-blue-600 hover:underline">
          Back to Messages
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
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
            Sending a message costs <span className="font-semibold">{conversation.dmCoinCost} coins</span> per message.
          </p>
        </div>
      )}

      {/* Error toast */}
      {error && conversation && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-950">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* PRD §3: "Gift them coins" — recipient cannot afford to reply */}
      {!recipientCanReply && otherUserId && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This person cannot reply right now — they may not have enough coins.
          </p>
          <Link
            href={`/wallet?transfer=${otherUserId}`}
            className="ml-3 shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
          >
            🪙 Gift them coins
          </Link>
        </div>
      )}

      {/* Message feed */}
      <div
        ref={feedRef}
        className="flex-1 space-y-4 overflow-y-auto p-4"
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
            className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
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
