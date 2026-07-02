/**
 * apps/android/src/routes/events.tsx
 *
 * Events / Cultural Calendar — mirrors apps/web/app/(app)/events/page.tsx:
 * Active Now / Upcoming platform events plus a Monthly Gift Drop card.
 * Gift Drop purchase is coin-cost on web (POST /api/economy/gifts/send) —
 * there is no Google Play Billing product for it yet (see report), so the
 * purchase button is gated to a friendly "unavailable" message on Android
 * rather than calling a non-existent IAP flow.
 */

import { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

type EventType = 'flash_xp' | 'guild_war' | 'cultural' | 'mystery_drop' | string;

interface PlatformEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  xpMultiplier?: number;
  rewardDescription?: string;
}

interface GiftDrop {
  id: string;
  name: string;
  description: string;
  coinCost: number;
  endsAt: string;
  owned: boolean;
  itemId?: string;
}

interface EventsData {
  events: PlatformEvent[];
  giftDrop: GiftDrop | null;
}

function mapEventRow(r: Record<string, unknown>): PlatformEvent {
  return {
    id: r.id as string,
    title: (r.name ?? r.title) as string,
    description: (r.description ?? '') as string,
    type: (r.event_type ?? r.type) as string,
    startsAt: (r.starts_at ?? r.startsAt ?? '') as string,
    endsAt: (r.ends_at ?? r.endsAt ?? '') as string,
    isActive: (r.is_active ?? r.isActive ?? false) as boolean,
    xpMultiplier: (r.xp_multiplier ?? r.xpMultiplier) as number | undefined,
    rewardDescription: r.rewardDescription as string | undefined,
  };
}

async function fetchEvents(): Promise<PlatformEvent[]> {
  const { data } = await apiClient.get<{ events?: Record<string, unknown>[] } | Record<string, unknown>[]>('/events');
  const raw = Array.isArray(data) ? data : (data?.events ?? []);
  return raw.map(mapEventRow);
}

async function fetchGiftDrop(): Promise<GiftDrop | null> {
  try {
    const { data } = await apiClient.get<{
      active?: { id: string; giftItemId?: string; title?: string; availableUntil?: string } | null;
    }>('/events/gift-drop');
    if (!data?.active) return null;
    return {
      id: data.active.id,
      name: data.active.title ?? 'Monthly Gift Drop',
      description: '',
      coinCost: 0,
      endsAt: data.active.availableUntil ?? new Date(Date.now() + 86400000).toISOString(),
      owned: false,
      itemId: data.active.giftItemId,
    };
  } catch {
    return null;
  }
}

function formatCountdown(endsAt: string): string {
  const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function useCountdown(endsAt: string | null): string {
  const [display, setDisplay] = useState(endsAt ? formatCountdown(endsAt) : '');
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setDisplay(formatCountdown(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return display;
}

function eventTypeLabel(t: (k: string, d?: string) => string, type: EventType): string {
  const map: Record<string, string> = {
    flash_xp: t('events.type.flashXp', 'Flash XP'),
    guild_war: t('events.type.guildWar', 'Guild War'),
    cultural: t('events.type.cultural', 'Cultural'),
    mystery_drop: t('events.type.mysteryDrop', 'Mystery Drop'),
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

function eventTypeColor(type: EventType): string {
  const map: Record<string, string> = {
    flash_xp: 'bg-amber-100 text-amber-700',
    guild_war: 'bg-red-100 text-red-700',
    cultural: 'bg-teal-100 text-teal-700',
    mystery_drop: 'bg-neutral-100 text-neutral-700',
  };
  return map[type] ?? 'bg-neutral-100 text-neutral-700';
}

function relativeStartTime(t: (k: string, o?: Record<string, unknown>) => string, startsAt: string): string {
  const diff = new Date(startsAt).getTime() - Date.now();
  if (diff <= 0) return t('events.startingSoon');
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t('events.startsIn', { time: `${min}m` });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('events.startsIn', { time: `${hr}h` });
  const days = Math.floor(hr / 24);
  return t('events.startsIn', { time: `${days}d` });
}

function GiftDropCard({ drop }: { drop: GiftDrop }) {
  const { t } = useTranslation();
  const countdown = useCountdown(drop.endsAt);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎁</span>
            <h2 className="text-sm font-semibold text-amber-700">{t('events.giftDrop.title')}</h2>
          </div>
          <p className="mt-1 text-lg font-bold text-neutral-900">{drop.name}</p>
          {drop.description && <p className="mt-0.5 text-sm text-neutral-600">{drop.description}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-amber-600">{t('events.giftDrop.endsIn')}</p>
          <p className="text-lg font-bold tabular-nums text-amber-700">{countdown}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        {drop.coinCost > 0 && (
          <span className="text-sm font-semibold text-neutral-700">{drop.coinCost.toLocaleString()} 🪙</span>
        )}
        {drop.owned ? (
          <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-700">
            {t('events.giftDrop.owned')}
          </span>
        ) : (
          <button
            disabled
            title={t('events.giftDrop.androidUnavailable', 'Not yet available for purchase on Android — open the app on web to claim this drop.')}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('events.giftDrop.buyNow')}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        {t('events.giftDrop.androidUnavailable', 'Not yet available for purchase on Android — open the app on web to claim this drop.')}
      </p>
    </div>
  );
}

function EventCard({ event }: { event: PlatformEvent }) {
  const { t } = useTranslation();
  const countdown = useCountdown(event.isActive ? event.endsAt : null);

  return (
    <div className={`rounded-xl border bg-white p-5 mb-3 ${event.isActive ? 'border-blue-300' : 'border-neutral-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${eventTypeColor(event.type)}`}>
              {eventTypeLabel(t, event.type)}
            </span>
            {event.isActive && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                {t('events.live')}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold text-neutral-900">{event.title}</h3>
          <p className="mt-0.5 text-sm text-neutral-600">{event.description}</p>
          {event.xpMultiplier && event.xpMultiplier > 1 && (
            <p className="mt-1 text-xs font-semibold text-amber-600">
              {t('events.xpMultiplier', { multiplier: event.xpMultiplier })}
            </p>
          )}
          {event.rewardDescription && <p className="mt-1 text-xs text-neutral-500">{event.rewardDescription}</p>}
        </div>
        <div className="shrink-0 text-right">
          {event.isActive && event.type === 'flash_xp' && countdown && (
            <div>
              <p className="text-xs font-semibold text-neutral-500">{t('events.giftDrop.endsIn')}</p>
              <p className="font-bold tabular-nums text-red-600">{countdown}</p>
            </div>
          )}
          {event.isActive && event.type !== 'flash_xp' && (
            <p className="text-xs text-neutral-500">
              {new Date(event.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </p>
          )}
          {!event.isActive && (
            <p className="text-xs font-semibold text-neutral-500">{relativeStartTime(t, event.startsAt)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EventsPage() {
  const { t } = useTranslation();

  const { data: events, status: eventsStatus, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: fetchEvents,
    staleTime: 30_000,
  });

  const { data: giftDrop } = useQuery({
    queryKey: ['events', 'gift-drop'],
    queryFn: fetchGiftDrop,
    staleTime: 30_000,
  });

  if (eventsStatus === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
        <h1 className="text-xl font-bold text-neutral-900 mb-4">{t('events.title')}</h1>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-neutral-200 bg-white p-5 mb-3 animate-pulse">
            <div className="h-4 bg-neutral-200 rounded w-32 mb-2" />
            <div className="h-3 bg-neutral-100 rounded w-full mb-1" />
            <div className="h-3 bg-neutral-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (eventsStatus === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  const activeEvents = (events ?? []).filter((e) => e.isActive);
  const upcomingEvents = (events ?? []).filter((e) => !e.isActive);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-4">{t('events.title')}</h1>

      {giftDrop && <GiftDropCard drop={giftDrop} />}

      {activeEvents.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">{t('events.activeNow')}</h2>
          {activeEvents.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </section>
      )}

      {upcomingEvents.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">{t('events.upcoming')}</h2>
          {upcomingEvents.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </section>
      )}

      {activeEvents.length === 0 && upcomingEvents.length === 0 && !giftDrop && (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📅</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">{t('events.noEvents')}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t('events.noEventsHint')}</p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/events')({
  component: EventsPage,
});
