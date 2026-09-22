"use client";

/**
 * components/classroom/DailyBars.tsx
 *
 * Minimal single-series 30-day bar chart for the classroom creator panel
 * ("detailed" stats tier). One hue, thin bars with rounded data-ends on a
 * shared baseline, 2px gaps, recessive axis text, and a per-bar hover
 * tooltip (native title + visible value on hover). The same numbers are
 * available as text in the stats tables around it.
 */

import { useState } from "react";

export function DailyBars({
  points,
  format,
  label,
}: {
  points: Array<{ day: string; value: number }>;
  format: (v: number) => string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const active = hover !== null ? points[hover] : null;
  return (
    <figure className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-neutral-500">{label}</span>
        <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
          {active ? `${active.day}: ${format(active.value)}` : format(points.reduce((s, p) => s + p.value, 0))}
        </span>
      </figcaption>
      <div className="mt-3 flex h-24 items-end gap-[2px] border-b border-neutral-200 dark:border-neutral-700" role="img" aria-label={label}>
        {points.map((p, i) => (
          <div
            key={p.day}
            className="flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            title={`${p.day}: ${format(p.value)}`}
          >
            <div
              className={`w-full rounded-t-[4px] ${hover === i ? "bg-violet-700 dark:bg-violet-300" : "bg-violet-500 dark:bg-violet-400"}`}
              style={{ height: p.value > 0 ? `${Math.max(4, (p.value / max) * 100)}%` : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{points[0]?.day}</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </figure>
  );
}
