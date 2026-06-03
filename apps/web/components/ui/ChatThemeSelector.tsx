"use client";

/**
 * ChatThemeSelector
 *
 * Displays five chat theme options. Non-default themes require Pro/Max plan.
 * Shows a lock icon for locked themes on lower plans.
 *
 * PRD §3 / §11: "Custom chat themes: No / No / Yes / Yes" (Free/Plus/Pro/Max)
 */

import { useState } from "react";

type ChatTheme = "default" | "midnight" | "ocean" | "forest" | "sunset";

interface ThemeOption {
  key: ChatTheme;
  label: string;
  colors: [string, string]; // [swatch1, swatch2]
  requiresPro: boolean;
}

const THEMES: ThemeOption[] = [
  { key: "default",  label: "Default",  colors: ["#ffffff", "#f3f4f6"], requiresPro: false },
  { key: "midnight", label: "Midnight", colors: ["#0f172a", "#1e3a5f"], requiresPro: true  },
  { key: "ocean",    label: "Ocean",    colors: ["#0891b2", "#a5f3fc"], requiresPro: true  },
  { key: "forest",   label: "Forest",   colors: ["#166534", "#bbf7d0"], requiresPro: true  },
  { key: "sunset",   label: "Sunset",   colors: ["#ea580c", "#fde68a"], requiresPro: true  },
];

interface ChatThemeSelectorProps {
  currentTheme: ChatTheme;
  plan: string;
  onSelect?: (theme: ChatTheme) => void;
}

export function ChatThemeSelector({ currentTheme, plan, onSelect }: ChatThemeSelectorProps) {
  const [selected, setSelected] = useState<ChatTheme>(currentTheme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUseTheme = (theme: ThemeOption) =>
    !theme.requiresPro || plan === "pro" || plan === "max";

  const handleSelect = async (theme: ThemeOption) => {
    if (!canUseTheme(theme)) return;
    if (selected === theme.key) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: theme.key }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save theme");
      }
      setSelected(theme.key);
      onSelect?.(theme.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-3">
        {THEMES.map((theme) => {
          const unlocked = canUseTheme(theme);
          const isActive = selected === theme.key;
          return (
            <button
              key={theme.key}
              type="button"
              onClick={() => handleSelect(theme)}
              disabled={!unlocked || saving}
              aria-label={`${theme.label} chat theme${!unlocked ? " (Pro/Max required)" : ""}`}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed ${
                isActive
                  ? "border-blue-600 shadow-md"
                  : unlocked
                  ? "border-neutral-200 hover:border-neutral-400 dark:border-neutral-700"
                  : "border-neutral-200 opacity-50 dark:border-neutral-800"
              }`}
            >
              {/* Color swatch */}
              <div
                className="h-8 w-full rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${theme.colors[0]} 50%, ${theme.colors[1]} 50%)`,
                }}
              />
              <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                {theme.label}
              </span>

              {/* Lock overlay for Pro-only themes */}
              {!unlocked && (
                <span
                  className="absolute right-1.5 top-1.5 text-xs"
                  aria-hidden="true"
                  title="Pro/Max plan required"
                >
                  🔒
                </span>
              )}

              {/* Active checkmark */}
              {isActive && (
                <span
                  className="absolute right-1.5 top-1.5 text-blue-600"
                  aria-hidden="true"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!["pro", "max"].includes(plan) && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Custom themes are available on <strong>Pro</strong> and <strong>Max</strong> plans.
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
