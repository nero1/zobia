"use client";

/**
 * app/(admin)/admin/support/tickets/[id]/page.tsx
 *
 * Staff ticket detail — thread view, reply box, assign/escalate/status controls.
 */

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";

interface Message {
  id: string;
  sender_id: string | null;
  sender_type: "user" | "staff" | "ai";
  body: string;
  created_at: string;
}

interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  assigned_to: string | null;
  is_ai_handled: boolean;
}

export default function AdminTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [escalateTarget, setEscalateTarget] = useState("");
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/support/tickets/${id}`, { credentials: "include" })
      .then((r) => {
        setAuthorized(r.ok);
        return r.ok ? r.json() : null;
      })
      .then((json) => {
        setTicket(json?.data?.ticket ?? null);
        setMessages(json?.data?.messages ?? []);
      });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message ?? "Failed to send reply");
      setReply("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: string) {
    await fetch(`/api/admin/support/tickets/${id}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function escalate() {
    if (!escalateTarget.trim()) return;
    setError(null);
    const res = await fetch(`/api/admin/support/tickets/${id}/escalate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: escalateTarget.trim() }),
    });
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Escalation failed");
      return;
    }
    setEscalateTarget("");
    load();
  }

  if (authorized === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">Not authorized</p>
      </div>
    );
  }
  if (!ticket) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/support/queue" className="text-sm text-primary-600 hover:underline">&larr; Back to queue</Link>
      <h1 className="mt-2 mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">{ticket.subject}</h1>
      <p className="mb-4 text-sm text-neutral-500">Status: {ticket.status} {ticket.is_ai_handled ? "· AI-triaged" : ""}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setStatus("pending")} className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">Mark Pending</button>
        <button onClick={() => setStatus("resolved")} className="rounded-lg bg-teal-100 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Mark Resolved</button>
        <button onClick={() => setStatus("closed")} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Close</button>
        <input
          type="text"
          placeholder="Escalate to user ID"
          value={escalateTarget}
          onChange={(e) => setEscalateTarget(e.target.value)}
          className="w-48 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button onClick={escalate} className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">Escalate</button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl p-3 text-sm ${
              m.sender_type === "ai"
                ? "bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-200"
                : m.sender_type === "staff"
                ? "bg-primary-50 text-primary-900 dark:bg-primary-950 dark:text-primary-200"
                : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            }`}
          >
            <p className="mb-1 text-xs font-semibold uppercase opacity-70">{m.sender_type}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply…"
          rows={3}
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button
          onClick={sendReply}
          disabled={sending || !reply.trim()}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
