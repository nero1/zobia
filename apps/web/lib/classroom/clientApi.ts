"use client";

/**
 * lib/classroom/clientApi.ts
 *
 * Browser-side fetch helper for /api/classroom/** — unwraps the standard
 * `{ success, data, error }` envelope and throws a typed error carrying the
 * API error `code` (for translateApiError) and `params` (e.g. a slug-change
 * cooldown's nextEligibleAt). Uses authFetch for silent token refresh.
 */

import { authFetch } from "@/lib/api/authFetch";

export class ClassroomApiError extends Error {
  code: string | null;
  status: number;
  params: Record<string, unknown> | null;
  constructor(message: string, status: number, code: string | null, params: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export async function classroomApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await authFetch(path.startsWith("/api/") ? path : `/api/classroom${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: { code?: string; message?: string; params?: Record<string, unknown> } | string | null }
    | null;
  if (!res.ok) {
    const err = json?.error;
    const message = typeof err === "string" ? err : err?.message ?? `Request failed (${res.status})`;
    const code = typeof err === "string" ? null : err?.code ?? null;
    const params = typeof err === "string" ? null : err?.params ?? null;
    throw new ClassroomApiError(message, res.status, code, params);
  }
  return (json?.data ?? (json as unknown)) as T;
}

/** Format a Naira amount stored in kobo. */
export function formatNgnKobo(kobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}
