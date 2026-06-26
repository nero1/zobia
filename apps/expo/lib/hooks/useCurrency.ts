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

/**
 * Returns the admin-configured currency display names.
 * Falls back to Credit/Credits/Star/Stars while loading or on error.
 * Uses the shared ['manifest'] query so no duplicate /manifest fetches occur.
 */
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
