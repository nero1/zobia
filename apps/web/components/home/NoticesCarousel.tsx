"use client";

/**
 * components/home/NoticesCarousel.tsx
 *
 * Home Dashboard notices carousel — fetches GET /api/notices (merged
 * notices/platform_events/announcement_banners, see that route's doc
 * comment) and shows one at a time, auto-advancing every ~5s, paused on
 * hover/touch. Starts at a random index on mount so the same item isn't
 * always shown first. Renders nothing when there are zero notices.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Notice {
  id: string;
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

const AUTO_ADVANCE_MS = 5000;
const CACHE_KEY = "zobia:home:notices:v1";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min client cache, within the 10-15 min staleness tolerance

function readCache(): Notice[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; notices: Notice[] };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.notices;
  } catch {
    return null;
  }
}

function writeCache(notices: Notice[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), notices }));
  } catch {
    // best-effort
  }
}

export function NoticesCarousel() {
  const { t } = useTranslation();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setNotices(cached);
      setIndex(cached.length > 0 ? Math.floor(Math.random() * cached.length) : 0);
      return;
    }
    let cancelled = false;
    fetch("/api/notices", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { notices?: Notice[] } } | null) => {
        if (cancelled) return;
        const list = json?.data?.notices ?? [];
        setNotices(list);
        writeCache(list);
        setIndex(list.length > 0 ? Math.floor(Math.random() * list.length) : 0);
      })
      .catch(() => {
        if (!cancelled) setNotices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = notices?.length ?? 0;

  useEffect(() => {
    if (paused || count <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, count]);

  const current = useMemo(() => (notices && count > 0 ? notices[index % count] : null), [notices, index, count]);

  if (!notices || count === 0 || !current) return null;

  function advance(delta: number) {
    setIndex((i) => (i + delta + count) % count);
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        setPaused(true);
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        setPaused(false);
        const startX = touchStartX.current;
        const endX = e.changedTouches[0]?.clientX ?? null;
        if (startX != null && endX != null) {
          const delta = endX - startX;
          if (Math.abs(delta) > 40) advance(delta < 0 ? 1 : -1);
        }
        touchStartX.current = null;
      }}
    >
      <button
        type="button"
        onClick={() => advance(1)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-label={t("notices.advance")}
      >
        {current.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xl dark:bg-blue-950/40">
            {current.icon ?? "📣"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">{current.title}</p>
          {current.body && (
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{current.body}</p>
          )}
        </div>
        {current.ctaLabel && current.ctaUrl && (
          <a
            href={current.ctaUrl}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {current.ctaLabel}
          </a>
        )}
      </button>
      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-2.5">
          {notices.map((n, i) => (
            <button
              key={n.id}
              type="button"
              aria-label={t("notices.goTo", { index: i + 1 })}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index % count ? "w-4 bg-blue-600" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
