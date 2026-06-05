"use client";

/**
 * app/(admin)/admin/messages/page.tsx
 *
 * Admin messaging panel.
 * Compose and send messages to users by plan, role, or specific selection.
 * View sent message history with per-recipient delivery details.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecipientMode = "all" | "by_plan" | "by_role" | "specific";

interface SentMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  recipientMode: RecipientMode;
  recipientsCount: number;
  deliveredCount: number;
  sentAt: string;
}

interface DeliveryRecord {
  userId: string;
  username: string;
  deliveredAt: string | null;
  readAt: string | null;
}

interface MessageDetail extends SentMessage {
  body: string;
  deliveries: DeliveryRecord[];
}

interface UserSearchResult {
  id: string;
  username: string;
  avatarEmoji: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_OPTIONS = ["free", "plus", "pro", "max"];
const ROLE_OPTIONS = ["user", "creator", "moderator", "guild_captain", "verified_creator"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MODE_BADGE: Record<RecipientMode, string> = {
  all: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  by_plan: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  by_role: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  specific: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const MODE_LABEL: Record<RecipientMode, string> = {
  all: "All Users",
  by_plan: "By Plan",
  by_role: "By Role",
  specific: "Specific Users",
};

// ---------------------------------------------------------------------------
// User search input
// ---------------------------------------------------------------------------

interface UserSearchProps {
  selected: UserSearchResult[];
  onAdd: (u: UserSearchResult) => void;
  onRemove: (id: string) => void;
}

function UserSearchInput({ selected, onAdd, onRemove }: UserSearchProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function handleChange(val: string) {
    setQ(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/users?q=${encodeURIComponent(val)}&limit=8`, { credentials: "include" });
        const data = (await res.json()) as { users: UserSearchResult[] };
        setResults(data.users.filter((u) => !selected.some((s) => s.id === u.id)));
      } catch { /* ignore */ }
      setSearching(false);
    }, 300);
  }

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search username…"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        {searching && <span className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />}
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-modal dark:border-neutral-700 dark:bg-neutral-800">
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onAdd(u); setQ(""); setResults([]); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
              >
                <span>{u.avatarEmoji}</span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <span key={u.id} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {u.avatarEmoji} @{u.username}
              <button type="button" onClick={() => onRemove(u.id)} className="ml-1 hover:text-blue-600">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message detail drawer
// ---------------------------------------------------------------------------

interface DetailDrawerProps {
  msg: MessageDetail;
  onClose: () => void;
}

function DetailDrawer({ msg, onClose }: DetailDrawerProps) {
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">Message Detail</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">✕</button>
      </div>
      <div className="flex-1 space-y-4 p-4">
        <div>
          <p className="text-xs text-neutral-500">Subject</p>
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">{msg.subject}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Body</p>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{msg.body}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
            <p className="text-xs text-neutral-500">Recipients</p>
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{msg.recipientsCount.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
            <p className="text-xs text-neutral-500">Delivered</p>
            <p className="text-lg font-bold text-teal-600">{msg.deliveredCount.toLocaleString()}</p>
          </div>
        </div>
        {msg.recipientMode === "specific" && msg.deliveries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Delivery Status</p>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-700">
                    <th className="px-3 py-2 text-left">User</th>
                    <th className="px-3 py-2 text-left">Delivered</th>
                    <th className="px-3 py-2 text-left">Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {msg.deliveries.map((d) => (
                    <tr key={d.userId}>
                      <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">@{d.username}</td>
                      <td className="px-3 py-2 text-neutral-500">{d.deliveredAt ? formatDate(d.deliveredAt) : "—"}</td>
                      <td className="px-3 py-2 text-neutral-500">{d.readAt ? formatDate(d.readAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin messaging page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminMessagesPage() {
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("all");
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [specificUsers, setSpecificUsers] = useState<UserSearchResult[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/messages", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        const data = (await res.json()) as { messages: SentMessage[] };
        setSentMessages(data.messages);
      } catch { /* ignore */ }
      setLoadingMessages(false);
    })();
  }, []);

  function toggleArr<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!subject || !body) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientMode,
          plans: selectedPlans,
          roles: selectedRoles,
          userIds: specificUsers.map((u) => u.id),
          subject,
          body,
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      showToast("Message sent");
      setSubject("");
      setBody("");
      setPreviewing(false);
      const refreshed = await fetch("/api/admin/messages", { credentials: "include" });
      const data = (await refreshed.json()) as { messages: SentMessage[] };
      setSentMessages(data.messages);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setSending(false);
    }
  }

  async function openDetail(id: string) {
    const res = await fetch(`/api/admin/messages/${id}`, { credentials: "include" });
    const data = (await res.json()) as MessageDetail;
    setSelectedMessage(data);
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Admin Messaging</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Compose panel */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Compose Message</h2>
          <form onSubmit={handleSend} className="space-y-4">
            {/* Recipient mode */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">To</label>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "by_plan", "by_role", "specific"] as RecipientMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRecipientMode(m)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${recipientMode === m ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"}`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            {recipientMode === "by_plan" && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Plans</p>
                <div className="flex flex-wrap gap-2">
                  {PLAN_OPTIONS.map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm capitalize">
                      <input type="checkbox" checked={selectedPlans.includes(p)} onChange={() => setSelectedPlans(toggleArr(selectedPlans, p))} className="rounded" />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {recipientMode === "by_role" && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Roles</p>
                <div className="flex flex-wrap gap-2">
                  {ROLE_OPTIONS.map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-1.5 text-sm capitalize">
                      <input type="checkbox" checked={selectedRoles.includes(r)} onChange={() => setSelectedRoles(toggleArr(selectedRoles, r))} className="rounded" />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {recipientMode === "specific" && (
              <UserSearchInput selected={specificUsers} onAdd={(u) => setSpecificUsers((prev) => [...prev, u])} onRemove={(id) => setSpecificUsers((prev) => prev.filter((u) => u.id !== id))} />
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Subject</label>
              <input required value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" placeholder="Message subject" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Body</label>
              <textarea required value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" placeholder="Message body…" />
            </div>

            {previewing && subject && body && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
                <p className="mb-1 text-xs font-semibold text-blue-600">Preview</p>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{body}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setPreviewing((p) => !p)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {previewing ? "Hide Preview" : "Preview"}
              </button>
              <button type="submit" disabled={sending} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {sending ? "Sending…" : "Send Message"}
              </button>
            </div>
          </form>
        </div>

        {/* Sent messages */}
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Sent Messages</h2>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loadingMessages
              ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse px-5 py-4">
                  <div className="mb-2 h-4 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
              ))
              : sentMessages.length === 0
              ? <p className="py-12 text-center text-sm text-neutral-500">No messages sent yet</p>
              : sentMessages.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openDetail(m.id)}
                  className="w-full px-5 py-4 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{m.subject}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${MODE_BADGE[m.recipientMode]}`}>{MODE_LABEL[m.recipientMode]}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">{m.bodyPreview}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-neutral-400">
                    <span>{m.recipientsCount.toLocaleString()} recipients</span>
                    <span>{m.deliveredCount.toLocaleString()} delivered</span>
                    <span className="ml-auto">{formatDate(m.sentAt)}</span>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedMessage && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedMessage(null)} />
          <DetailDrawer msg={selectedMessage} onClose={() => setSelectedMessage(null)} />
        </>
      )}
    </div>
  );
}
