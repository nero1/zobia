/**
 * apps/android/src/components/ui/RoomPulseBar.tsx
 *
 * Ported from apps/web/components/ui/RoomPulseBar.tsx (PRD §2.2 "Room pulse
 * bars animate outside room cards to show live activity volume") so the
 * Capacitor app mirrors the web/PWA room list and room screen.
 * Horizontal activity bar: green 0-50%, amber 50-80%, red 80%+.
 */

interface RoomPulseBarProps {
  activeCount: number;
  maxCapacity: number;
  className?: string;
}

export function RoomPulseBar({ activeCount, maxCapacity, className = '' }: RoomPulseBarProps) {
  const pct = maxCapacity > 0 ? Math.min(100, Math.round((activeCount / maxCapacity) * 100)) : 0;

  const barColor = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-400' : 'bg-teal-500';
  const textColor = pct >= 80 ? 'text-red-600' : pct >= 50 ? 'text-amber-600' : 'text-teal-600';

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold tabular-nums ${textColor}`}>{activeCount.toLocaleString()} active</span>
        <span className="text-neutral-400 tabular-nums">{maxCapacity.toLocaleString()} cap</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% capacity`}
      >
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
