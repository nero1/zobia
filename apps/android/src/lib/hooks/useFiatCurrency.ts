/**
 * apps/android/src/lib/hooks/useFiatCurrency.ts
 *
 * Android port of apps/web/lib/hooks/useFiatCurrency.ts — resolves the
 * signed-in user's display currency (NGN for Nigeria, USD everywhere else;
 * see apps/web/lib/currency/) via the same GET /api/me/currency endpoint web
 * uses. Distinct from useCurrency.ts, which only fetches the admin-
 * configurable in-game coin/star NAMES, not fiat.
 *
 * Display-only: does not affect how Android purchases are made (Google Play
 * Billing, priced by Play itself per §18) — only how already-known NGN-kobo
 * amounts (earnings, classroom fees, etc.) are shown.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export type CurrencyCode = 'NGN' | 'USD';

export interface FiatCurrency {
  currency: CurrencyCode;
  isNigeria: boolean;
  usdToNgnRate: string;
}

const DEFAULTS: FiatCurrency = { currency: 'USD', isNigeria: false, usdToNgnRate: '1600' };

async function fetchFiatCurrency(): Promise<FiatCurrency> {
  try {
    const res = await apiClient.get<{ data?: FiatCurrency }>('/me/currency');
    return res.data?.data ?? DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useFiatCurrency() {
  return useQuery({
    queryKey: ['me', 'currency'],
    queryFn: fetchFiatCurrency,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

const FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  NGN: new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
};

/** Format an NGN-kobo amount client-side given an already-fetched
 *  FiatCurrency (from useFiatCurrency()). Uses plain division — Android's
 *  display-only formatting has no crypto-grade precision requirement (all
 *  real money math stays server-side, per lib/currency/ and Decimal.js). */
export function formatKoboClient(amountKobo: number | string, fiat: FiatCurrency): string {
  const ngnMajor = Number(amountKobo) / 100;
  const major = fiat.currency === 'NGN' ? ngnMajor : ngnMajor / Number(fiat.usdToNgnRate || 1600);
  return FORMATTERS[fiat.currency].format(major);
}
