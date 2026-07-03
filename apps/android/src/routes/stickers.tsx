/**
 * apps/android/src/routes/stickers.tsx
 *
 * Sticker Store — mirrors apps/web/app/(app)/stickers/page.tsx: grid of
 * sticker packs (free / coins / earn), unlock action.
 *
 * CONTRACT NOTE (see report): web's unlock call went to
 * /api/stickers/:packId/unlock, which doesn't exist — the real endpoint is
 * POST /api/stickers with { packId } in the body (fixed in the same commit,
 * apps/web/app/(app)/stickers/page.tsx). This page uses the real contract.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

type PackUnlockType = 'free' | 'coins' | 'earn';

interface StickerPack {
  id: string;
  name: string;
  coverEmoji: string;
  unlockType: PackUnlockType;
  coinPrice: number | null;
  earnCondition: string | null;
  stickerCount: number;
  owned: boolean;
}

interface StickerPackRow {
  id: string;
  name: string;
  cover_sticker_url: string | null;
  pack_type: 'free' | 'earnable' | 'premium';
  coin_price: number;
  unlock_condition: string | null;
  sticker_count: number;
  unlocked: boolean;
}

async function fetchPacks(): Promise<StickerPack[]> {
  const { data } = await apiClient.get<{ packs: StickerPackRow[] }>('/stickers');
  return (data?.packs ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    coverEmoji: r.cover_sticker_url ?? '🎨',
    unlockType: r.pack_type === 'earnable' ? 'earn' : r.pack_type === 'premium' ? 'coins' : 'free',
    coinPrice: r.coin_price ?? null,
    earnCondition: r.unlock_condition ?? null,
    stickerCount: r.sticker_count ?? 0,
    owned: r.unlocked ?? false,
  }));
}

function StickersPage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const { data: packs, status } = useQuery({ queryKey: ['stickers'], queryFn: fetchPacks });

  const unlockMutation = useMutation({
    mutationFn: async (packId: string) => { await apiClient.post('/stickers', { packId }); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stickers'] });
      // ZSB-11 fix: unlocking a paid sticker pack spends coins server-side
      // but never invalidated the shared balance query — see gifts.tsx's
      // closeModal for the same fix and full explanation.
      qc.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      </div>
    );
  }

  if (status === 'error' || !packs) {
    return <div className="p-6 text-sm text-red-600">{t('error.generic')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{t('stickers.title', 'Sticker Store')}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{t('stickers.subtitle', 'Unlock sticker packs to use in messages and rooms')}</p>
      </div>

      {packs.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16">
          <span className="text-5xl">😶</span>
          <p className="mt-3 font-semibold text-neutral-700">{t('stickers.empty', 'No sticker packs yet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {packs.map((pack) => {
            const badgeLabel = pack.unlockType === 'free' ? t('stickers.free', 'Free') : pack.unlockType === 'coins' ? `🪙 ${pack.coinPrice?.toLocaleString()} ${currency.softPlural}` : t('stickers.earn', 'Earn');
            const badgeClasses = pack.unlockType === 'free' ? 'bg-teal-100 text-teal-700' : pack.unlockType === 'coins' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
            return (
              <div key={pack.id} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
                <div className="relative mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-3xl">
                  {pack.coverEmoji}
                  {pack.owned && <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-xs text-white">✓</span>}
                </div>
                <p className="text-sm font-semibold text-neutral-900">{pack.name}</p>
                <p className="mb-1.5 text-xs text-neutral-500">{t('stickers.count', '{{count}} stickers', { count: pack.stickerCount })}</p>
                <span className={`self-start rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClasses}`}>{badgeLabel}</span>
                {pack.unlockType === 'earn' && pack.earnCondition && (
                  <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-700">🔒 {pack.earnCondition}</p>
                )}
                <div className="mt-auto pt-3">
                  {pack.owned ? (
                    <div className="rounded-xl bg-teal-50 py-1.5 text-center text-xs font-semibold text-teal-700">✓ {t('stickers.owned', 'Owned')}</div>
                  ) : pack.unlockType === 'earn' ? (
                    <div className="rounded-xl bg-neutral-100 py-1.5 text-center text-xs font-semibold text-neutral-500">🔒 {t('stickers.locked', 'Locked')}</div>
                  ) : (
                    <button
                      onClick={() => unlockMutation.mutate(pack.id)}
                      disabled={unlockMutation.isPending}
                      className="w-full rounded-xl bg-primary-600 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {unlockMutation.isPending ? t('stickers.unlocking', 'Unlocking…') : pack.unlockType === 'free' ? t('stickers.getFree', 'Get Free') : t('stickers.unlock', 'Unlock')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/stickers')({
  component: StickersPage,
});
