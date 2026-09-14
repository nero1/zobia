export const dynamic = 'force-dynamic';

/**
 * /api/admin/payments/crypto
 *
 * Admin config for the crypto payment provider: per-currency discounts,
 * price-feed refresh interval, live prices (with source), manual overrides,
 * and whether the receiving-address env vars are configured.
 *
 * GET   — current state of everything above.
 * PATCH — update discounts / refresh interval / a manual override.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { db } from "@/lib/db";
import { invalidateManifestCache } from "@/lib/manifest";
import { SUPPORTED_CURRENCIES } from "@/lib/payments/crypto/tokens";
import {
  getUsdPrice,
  getPriceRefreshIntervalMinutes,
  setManualOverride,
  clearManualOverride,
} from "@/lib/payments/crypto/priceFeed";
import { getAllCryptoDiscounts } from "@/lib/payments/crypto/settings";

export const GET = withAdminAuth(async (_req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const [discounts, refreshMinutes, prices] = await Promise.all([
      getAllCryptoDiscounts(),
      getPriceRefreshIntervalMinutes(),
      Promise.all(
        SUPPORTED_CURRENCIES.map(async (symbol) => {
          try {
            const p = await getUsdPrice(symbol);
            return { symbol, usdPrice: p.usdPrice.toString(), source: p.source, fetchedAt: p.fetchedAt.toISOString() };
          } catch (err) {
            return { symbol, usdPrice: null, source: "unavailable" as const, error: String(err) };
          }
        })
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        discounts,
        refreshMinutes,
        prices,
        receivingAddressesConfigured: {
          bsc: !!process.env.CRYPTO_RECEIVING_ADDRESS_BSC,
          solana: !!process.env.CRYPTO_RECEIVING_ADDRESS_SOLANA,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

const PatchSchema = z.object({
  discounts: z.record(z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]), z.number().min(0).max(90)).optional(),
  refreshMinutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
  manualOverride: z
    .object({
      symbol: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]),
      usdPrice: z.number().positive().nullable(), // null clears the override
      expiresInMinutes: z.number().int().positive().max(60 * 24 * 30).nullable().optional(), // null/omitted = no expiry
    })
    .optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, PatchSchema);

    if (body.discounts) {
      const existing = await getAllCryptoDiscounts();
      const merged = { ...existing, ...body.discounts };
      await db.query(
        `INSERT INTO x_manifest (key, value, updated_at) VALUES ('payment_crypto_discounts', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(merged)]
      );
      await invalidateManifestCache();
    }

    if (typeof body.refreshMinutes === "number") {
      await db.query(
        `INSERT INTO x_manifest (key, value, updated_at) VALUES ('payment_crypto_price_refresh_minutes', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(body.refreshMinutes)]
      );
      await invalidateManifestCache();
    }

    if (body.manualOverride) {
      const { symbol, usdPrice, expiresInMinutes } = body.manualOverride;
      if (usdPrice === null) {
        await clearManualOverride(symbol as never);
      } else {
        const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60_000) : null;
        await setManualOverride(symbol as never, new Decimal(usdPrice), auth.user.sub, expiresAt);
      }
      writeAuditLog({
        actorId: auth.user.sub,
        action: "admin_crypto_rate_override_set",
        targetType: "crypto_exchange_rate_override",
        targetId: symbol,
        metadata: { usdPrice, expiresInMinutes },
      });
    }

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
