import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface CurrencyNames {
  softSingular: string;
  softPlural: string;
  premiumSingular: string;
  premiumPlural: string;
}

const DEFAULTS: CurrencyNames = {
  softSingular: "Credit",
  softPlural: "Credits",
  premiumSingular: "Star",
  premiumPlural: "Stars",
};

interface ManifestCurrencyResponse {
  currency?: {
    softNameSingular?: string;
    softNamePlural?: string;
    premiumNameSingular?: string;
    premiumNamePlural?: string;
  };
}

async function fetchCurrencyNames(): Promise<CurrencyNames> {
  try {
    const { data } = await apiClient.get<ManifestCurrencyResponse>("/api/manifest");
    return {
      softSingular: data.currency?.softNameSingular ?? DEFAULTS.softSingular,
      softPlural: data.currency?.softNamePlural ?? DEFAULTS.softPlural,
      premiumSingular: data.currency?.premiumNameSingular ?? DEFAULTS.premiumSingular,
      premiumPlural: data.currency?.premiumNamePlural ?? DEFAULTS.premiumPlural,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Returns the admin-configured currency display names.
 * Falls back to Credit/Credits/Star/Stars while loading or on error.
 * Results are cached for 5 minutes via React Query.
 */
export function useCurrency(): CurrencyNames {
  const { data } = useQuery<CurrencyNames>({
    queryKey: ["manifest", "currency"],
    queryFn: fetchCurrencyNames,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
