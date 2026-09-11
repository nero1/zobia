/**
 * apps/android/src/lib/hooks/useCurrency.ts
 *
 * Adapted from apps/expo/lib/hooks/useCurrency.ts.
 * Only change: import useManifest from Android lib path.
 */

import { useManifest } from '@/lib/hooks/useManifest';

export interface CurrencyNames {
  softSingular: string;
  softPlural: string;
  premiumSingular: string;
  premiumPlural: string;
}

const DEFAULTS: CurrencyNames = {
  softSingular: 'Credit',
  softPlural: 'Credits',
  premiumSingular: 'Star',
  premiumPlural: 'Stars',
};

export function useCurrency(): CurrencyNames {
  const manifest = useManifest();
  const currency = manifest?.currency;
  if (!currency) return DEFAULTS;
  return {
    softSingular: currency.softNameSingular ?? DEFAULTS.softSingular,
    softPlural: currency.softNamePlural ?? DEFAULTS.softPlural,
    premiumSingular: currency.premiumNameSingular ?? DEFAULTS.premiumSingular,
    premiumPlural: currency.premiumNamePlural ?? DEFAULTS.premiumPlural,
  };
}

/**
 * Picks the singular form of an admin-configured currency name when `amount`
 * is exactly 1, the plural form otherwise (e.g. "1 Star" vs "5 Stars").
 */
export function currencyLabel(amount: number, singular: string, plural: string): string {
  return amount === 1 ? singular : plural;
}
