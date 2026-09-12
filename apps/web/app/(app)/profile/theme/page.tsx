"use client";

/**
 * app/(app)/profile/theme/page.tsx
 *
 * Profile theme picker — equip a free/owned theme, or buy a locked one with
 * Credits/Stars. Mirrors the blog theme picker's availability model
 * (free_default / plan_included / owned / purchasable / locked).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface ThemeTokens {
  bg: string;
  card: string;
  accent: string;
  text: string;
  muted: string;
}

interface ThemeOption {
  id: string;
  name: string;
  description: string | null;
  config: ThemeTokens;
  credits_cost: number | null;
  stars_cost: number | null;
  availability: "free_default" | "plan_included" | "owned" | "purchasable" | "locked";
  isActive: boolean;
}

export default function ProfileThemePage() {
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/profile-themes", { credentials: "include" });
      const json = (await res.json()) as { data?: { themes: ThemeOption[] } };
      setThemes(json.data?.themes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function equip(theme: ThemeOption, currency?: "credits" | "stars") {
    setBusy(theme.id);
    try {
      const res = await fetch("/api/profile-themes/equip", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: theme.id, currency }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } })?.error?.message ?? "Failed to equip theme");
      }
      showToast(`${theme.name} equipped!`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to equip theme", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/settings" className="text-sm text-neutral-500 hover:underline">← Settings</Link>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">🎨 Profile Theme</h1>
        <p className="mt-1 text-sm text-neutral-500">Pick a color skin for your profile. More themes are sold on the <Link href="/market/platform?category=cosmetics_themes" className="text-blue-600 hover:underline">Market</Link>.</p>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {themes.map((theme) => (
            <div
              key={theme.id}
              className="flex flex-col overflow-hidden rounded-2xl border shadow-sm"
              style={{ borderColor: theme.isActive ? theme.config.accent : "transparent", backgroundColor: theme.config.card }}
            >
              <div className="h-16" style={{ background: `linear-gradient(135deg, ${theme.config.bg}, ${theme.config.accent})` }} />
              <div className="p-3">
                <p className="text-sm font-semibold" style={{ color: theme.config.text }}>{theme.name}</p>
                {theme.availability === "purchasable" && theme.credits_cost && (
                  <p className="mt-1 text-xs" style={{ color: theme.config.muted }}>🪙 {theme.credits_cost.toLocaleString()}</p>
                )}
                <button
                  onClick={() =>
                    theme.availability === "purchasable"
                      ? equip(theme, "credits")
                      : equip(theme)
                  }
                  disabled={busy === theme.id || theme.isActive || theme.availability === "locked"}
                  className="mt-2 w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: theme.config.accent }}
                >
                  {theme.isActive ? "Equipped" : theme.availability === "purchasable" ? "Buy & Equip" : theme.availability === "locked" ? "Locked" : "Equip"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
