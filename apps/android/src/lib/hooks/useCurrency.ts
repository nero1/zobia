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
