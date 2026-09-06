"use client";

/**
 * components/help/HelpSearchBox.tsx
 *
 * Search box for the Help Center homepage — submits to the SEO-friendly
 * /help/search?q=... results page (Feature 2 §2).
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function HelpSearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    router.push(`/help/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the Help Center…"
        className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm"
      />
      <button type="submit" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
        Search
      </button>
    </form>
  );
}
