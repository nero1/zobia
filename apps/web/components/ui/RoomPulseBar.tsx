"use client";

/**
 * components/ui/RoomPulseBar.tsx
 *
 * Horizontal activity bar for rooms.
 * Fills left-to-right based on active/capacity ratio.
 * Color: green 0-50%, yellow 50-80%, red 80%+.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoomPulseBarProps {
  activeCount: number;
  maxCapacity: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * RoomPulseBar — horizontal progress bar showing room activity level.
 */
export function RoomPulseBar({ activeCount, maxCapacity, className = "" }: RoomPulseBarProps) {
  const pct = maxCapacity > 0 ? Math.min(100, Math.round((activeCount / maxCapacity) * 100)) : 0;

  const barColor =
    pct >= 80
      ? "bg-red-500"
      : pct >= 50
      ? "bg-amber-400"
      : "bg-teal-500";

  const textColor =
    pct >= 80
      ? "text-red-600 dark:text-red-400"
      : pct >= 50
      ? "text-amber-600 dark:text-amber-400"
      : "text-teal-600 dark:text-teal-400";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {/* Label row */}
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold tabular-nums ${textColor}`}>
          {activeCount.toLocaleString()} active
        </span>
        <span className="text-neutral-400 tabular-nums">
          {maxCapacity.toLocaleString()} cap
        </span>
      </div>
      {/* Bar */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% capacity`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
