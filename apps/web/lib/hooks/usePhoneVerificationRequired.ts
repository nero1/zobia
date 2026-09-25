"use client";

import { useQuery } from "@tanstack/react-query";

interface ManifestPhoneResponse {
  phoneVerificationRequired?: boolean;
}

async function fetchPhoneVerificationRequired(): Promise<boolean> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return false;
    const data = (await res.json()) as ManifestPhoneResponse;
    return data.phoneVerificationRequired ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether the admin has turned on SMS OTP verification for the Settings
 * "Phone Number" field (x_manifest `phone_verification_required`, default
 * off). Defaults to `false` while loading or on error, matching the
 * server-side default — worst case the UI briefly assumes no-OTP and the
 * /api/users/phone/start response corrects it (`requiresVerification: true`).
 */
export function usePhoneVerificationRequired(): boolean {
  const { data } = useQuery<boolean>({
    queryKey: ["manifest", "phoneVerificationRequired"],
    queryFn: fetchPhoneVerificationRequired,
    staleTime: 5 * 60_000,
    placeholderData: false,
  });
  return data ?? false;
}
