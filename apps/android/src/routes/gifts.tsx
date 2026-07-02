/**
 * apps/android/src/routes/gifts.tsx
 *
 * Gifts hub — mirrors apps/web/app/(app)/gifts/page.tsx: Received/Sent gift
 * history tabs, and a "Send a Gift" flow (recipient search, tier selection,
 * wallet balance, confirm), including the PIN-required re-auth step gift
 * sends can trigger (POST /api/economy/gifts/send → 403 PIN_REQUIRED).
 */

import { useState, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface GiftUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface GiftRecord {
  id: string;
  createdAt: string;
  status: string;
  sender: GiftUser;
  recipient: GiftUser;
  giftItem: { name: string; emoji: string; tier: number };
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
}

interface GiftTier {
  tier: number;
  label: string;
  gifts: GiftItem[];
}

interface Catalogue {
  tiers: GiftTier[];
}

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface WalletBalance {
  coins: number;
}

type Tab = 'received' | 'sent';

const TIER_COLOUR: Record<number, string> = {
  1: 'bg-neutral-100 text-neutral-600',
  2: 'bg-success-50 text-success-600',
  3: 'bg-amber-100 text-amber-700',
  4: 'bg-blue-100 text-blue-700',
  5: 'bg-yellow-100 text-yellow-700',
};

function tierColour(tier: number) {
  return TIER_COLOUR[tier] ?? TIER_COLOUR[1];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// Raw row shapes (backend uses snake_case for gift history).
interface GiftHistoryRow {
  id: string;
  created_at: string;
  status: string;
  sender_id: string;
  sender_username: string | null;
  sender_display_name: string | null;
  sender_avatar_emoji: string | null;
  recipient_id: string;
  recipient_username: string | null;
  recipient_display_name: string | null;
  recipient_avatar_emoji: string | null;
  gift_name: string;
  gift_emoji: string;
  gift_tier: number;
}

function mapGift(row: GiftHistoryRow): GiftRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    sender: { id: row.sender_id, username: row.sender_username, displayName: row.sender_display_name, avatarEmoji: row.sender_avatar_emoji },
    recipient: { id: row.recipient_id, username: row.recipient_username, displayName: row.recipient_display_name, avatarEmoji: row.recipient_avatar_emoji },
    giftItem: { name: row.gift_name, emoji: row.gift_emoji, tier: row.gift_tier },
  };
}

async function fetchGifts(direction: Tab): Promise<GiftRecord[]> {
  const { data } = await apiClient.get<{ gifts: GiftHistoryRow[] }>(`/economy/gifts?type=${direction}&limit=40`);
  return (data?.gifts ?? []).map(mapGift);
}

async function fetchCatalogue(): Promise<Catalogue> {
  const { data } = await apiClient.get<Catalogue>('/economy/gifts/catalogue');
  return data;
}

async function fetchWallet(): Promise<WalletBalance> {
  const { data } = await apiClient.get<{ coins: number }>('/economy/coins/balance');
  return { coins: data?.coins ?? 0 };
}

async function searchUsers(q: string): Promise<UserSuggestion[]> {
  const { data } = await apiClient.get<{ users?: UserSuggestion[]; data?: { users: UserSuggestion[] } }>(
    `/users/search?q=${encodeURIComponent(q)}&limit=6`
  );
  return data?.users ?? data?.data?.users ?? [];
}

// ---------------------------------------------------------------------------
// Send Gift panel
// ---------------------------------------------------------------------------

function SendGiftPanel({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<UserSuggestion | null>(null);
  const [activeTier, setActiveTier] = useState<number | null>(null);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const pendingSend = useRef<{ giftItemId: string; recipientId: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: catalogue } = useQuery({ queryKey: ['gifts', 'catalogue'], queryFn: fetchCatalogue, staleTime: 5 * 60_000 });
  const { data: wallet } = useQuery({ queryKey: ['gifts', 'wallet'], queryFn: fetchWallet });

  useEffect(() => {
    if (catalogue && activeTier === null) setActiveTier(catalogue.tiers[0]?.tier ?? 1);
  }, [catalogue, activeTier]);

  useEffect(() => {
    if (recipient) return;
    if (search.length < 2) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      searchUsers(search)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, recipient]);

  const sendMutation = useMutation({
    mutationFn: async ({ giftItemId, recipientId }: { giftItemId: string; recipientId: string }) => {
      await apiClient.post('/economy/gifts/send', { giftItemId, recipientId });
    },
    onSuccess: () => setSent(true),
    onError: (err: unknown, variables) => {
      const e = err as { response?: { status?: number; data?: { code?: string; error?: string } } };
      if (e.response?.status === 403 && e.response.data?.code === 'PIN_REQUIRED') {
        pendingSend.current = variables;
        setPin('');
        setPinError(null);
        setShowPin(true);
        return;
      }
      setError(e.response?.data?.error ?? t('error.generic'));
    },
  });

  const handleSend = () => {
    if (!recipient || !selectedGift) return;
    setError(null);
    sendMutation.mutate({ giftItemId: selectedGift.id, recipientId: recipient.id });
  };

  const handlePinVerify = async () => {
    if (pin.trim().length < 4) { setPinError(t('error.generic')); return; }
    setVerifyingPin(true);
    setPinError(null);
    try {
      await apiClient.post('/auth/pin/verify', { pin: pin.trim() });
      setShowPin(false);
      setPin('');
      if (pendingSend.current) {
        const { giftItemId, recipientId } = pendingSend.current;
        pendingSend.current = null;
        sendMutation.mutate({ giftItemId, recipientId });
      }
    } catch {
      setPinError(t('error.generic'));
    } finally {
      setVerifyingPin(false);
    }
  };

  const tierData = catalogue?.tiers.find((tr) => tr.tier === activeTier);

  if (showPin) {
    return (
      <div className="flex flex-col gap-4 px-4 py-4">
        <h3 className="text-base font-bold text-neutral-900">{t('android.pin.title')}</h3>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-center text-xl tracking-widest focus:border-primary-500 focus:outline-none"
          autoFocus
        />
        {pinError && <p className="text-sm text-red-600">{pinError}</p>}
        <div className="flex gap-3">
          <button onClick={() => setShowPin(false)} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">
            {t('gifts.send.cancel')}
          </button>
          <button
            onClick={handlePinVerify}
            disabled={verifyingPin || pin.length < 4}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {verifyingPin ? t('gifts.send.sending') : t('common.confirm')}
          </button>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 text-center">
        <span className="text-5xl">{selectedGift?.emoji}</span>
        <p className="text-lg font-semibold text-neutral-900">{t('gifts.send.success', { username: recipient?.username })}</p>
        <p className="text-sm text-neutral-500">{t('gifts.send.successHint', { name: selectedGift?.name })}</p>
        <button onClick={onSent} className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white">
          {t('gifts.send.done')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-neutral-700">{t('gifts.send.recipientLabel')}</label>
        {recipient ? (
          <div className="flex items-center justify-between rounded-xl border border-primary-300 bg-primary-50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-sm">{recipient.avatarEmoji || '🙂'}</div>
              <span className="text-sm font-medium text-neutral-900">@{recipient.username}</span>
            </div>
            <button
              onClick={() => { setRecipient(null); setSearch(''); setSelectedGift(null); }}
              disabled={sendMutation.isPending}
              className="text-xs text-neutral-500 disabled:opacity-50"
            >
              {t('gifts.send.change')}
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('gifts.send.recipientSearch')}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
            />
            {(suggestions.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
                {searching && <div className="px-4 py-3 text-sm text-neutral-500">{t('gifts.send.searching')}</div>}
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setRecipient(u); setSearch(u.username); setSuggestions([]); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-sm">{u.avatarEmoji || '🙂'}</div>
                    <div>
                      <p className="font-medium text-neutral-900">{u.displayName ?? u.username}</p>
                      <p className="text-xs text-neutral-500">@{u.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {catalogue && recipient && (
        <>
          {wallet && <p className="text-xs text-neutral-500">{t('gifts.send.walletBalance', { amount: wallet.coins.toLocaleString() })}</p>}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {catalogue.tiers.map((tr) => (
              <button
                key={tr.tier}
                onClick={() => { setActiveTier(tr.tier); setSelectedGift(null); }}
                disabled={sendMutation.isPending}
                className={`shrink-0 rounded-full border-2 px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                  activeTier === tr.tier ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-600'
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(tierData?.gifts ?? []).map((gift) => {
              const canAfford = (wallet?.coins ?? 0) >= gift.coinCost;
              const isSelected = selectedGift?.id === gift.id;
              return (
                <button
                  key={gift.id}
                  onClick={() => canAfford && setSelectedGift(isSelected ? null : gift)}
                  disabled={!canAfford || sendMutation.isPending}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2.5 text-center ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50'
                      : canAfford
                        ? 'border-neutral-200 bg-neutral-50'
                        : 'border-neutral-100 bg-neutral-50 opacity-40'
                  }`}
                >
                  <span className="text-2xl leading-none">{gift.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight text-neutral-700">{gift.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${tierColour(gift.tier)}`}>
                    🪙 {gift.coinCost.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-600">
          {t('gifts.send.cancel')}
        </button>
        <button
          onClick={handleSend}
          disabled={!recipient || !selectedGift || sendMutation.isPending}
          className="rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sendMutation.isPending
            ? t('gifts.send.sending')
            : selectedGift
              ? t('gifts.send.sendBtn', { emoji: selectedGift.emoji, name: selectedGift.name })
              : t('gifts.sendBtn')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gift history row
// ---------------------------------------------------------------------------

function GiftRow({ gift, tab }: { gift: GiftRecord; tab: Tab }) {
  const { t } = useTranslation();
  const other = tab === 'sent' ? gift.recipient : gift.sender;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-2xl leading-none">{gift.giftItem.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{gift.giftItem.name}</p>
        <p className="truncate text-xs text-neutral-500">
          {tab === 'sent' ? t('gifts.row.to') : t('gifts.row.from')} @{other.username ?? 'unknown'}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tierColour(gift.giftItem.tier)}`}>
          {t('gifts.send.tierLabel', { tier: gift.giftItem.tier })}
        </span>
        <span className="text-[10px] text-neutral-400">{relativeTime(gift.createdAt)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function GiftsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('received');
  const [showModal, setShowModal] = useState(false);

  const { data: gifts, status, refetch } = useQuery({ queryKey: ['gifts', 'history', tab], queryFn: () => fetchGifts(tab) });

  const closeModal = () => {
    setShowModal(false);
    refetch();
    qc.invalidateQueries({ queryKey: ['gifts', 'wallet'] });
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">🎁 {t('gifts.title')}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{t('gifts.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="shrink-0 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {t('gifts.sendBtn')}
        </button>
      </div>

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 mx-4 mb-3">
        {(['received', 'sent'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === tb ? 'bg-primary-600 text-white' : 'text-neutral-500'}`}
          >
            {t(`gifts.tabs.${tb}`)}
          </button>
        ))}
      </div>

      <div className="bg-white mx-4 rounded-2xl border border-neutral-200 mb-6">
        {status === 'pending' ? (
          <div className="divide-y divide-neutral-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-neutral-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 rounded bg-neutral-200" />
                  <div className="h-2.5 w-20 rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-neutral-500">{t('error.generic')}</p>
            <button onClick={() => refetch()} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700">
              {t('android.error.retry')}
            </button>
          </div>
        ) : gifts && gifts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center px-4">
            <span className="text-4xl">🎁</span>
            <div>
              <p className="font-semibold text-neutral-900">{tab === 'received' ? t('gifts.empty.received') : t('gifts.empty.sent')}</p>
              <p className="mt-1 text-sm text-neutral-500">{tab === 'received' ? t('gifts.empty.receivedHint') : t('gifts.empty.sentHint')}</p>
            </div>
            {tab === 'sent' && (
              <button onClick={() => setShowModal(true)} className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white">
                {t('gifts.sendBtn')}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {gifts?.map((gift) => (
              <GiftRow key={gift.id} gift={gift} tab={tab} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="fixed left-4 right-4 top-1/2 z-50 max-h-[85vh] -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-4 py-4">
              <h2 className="text-base font-semibold text-neutral-900">{t('gifts.send.title')}</h2>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 text-neutral-500">
                <span className="text-lg leading-none">✕</span>
              </button>
            </div>
            <SendGiftPanel onClose={() => setShowModal(false)} onSent={closeModal} />
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/gifts')({
  component: GiftsPage,
});
