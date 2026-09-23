export const dynamic = "force-dynamic";

/**
 * GET /api/economy/crypto/balances
 *
 * The signed-in user's crypto-native balances (creator_crypto_balances) plus
 * their recent crypto_balance_ledger entries — shown in the wallet's Crypto
 * tab. Only returns anything once an admin has enabled crypto payouts; the
 * feature is entirely hidden otherwise so nobody sees a balance they can
 * never withdraw.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getCryptoPayoutsEnabled, getCryptoPayoutMode, getCryptoPayoutThreshold } from "@/lib/payments/crypto/payouts";
import { getToken, explorerTxUrl, SUPPORTED_CURRENCIES } from "@/lib/payments/crypto/tokens";
import type { CryptoCurrency } from "@zobia/types";

interface BalanceRow {
  currency: string;
  balance_base_units: string;
}

interface LedgerRow {
  id: string;
  currency: string;
  amount_base_units: string;
  source_type: string;
  reference_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const [enabled, mode] = await Promise.all([getCryptoPayoutsEnabled(), getCryptoPayoutMode()]);
    if (!enabled || mode !== "crypto") {
      return NextResponse.json({ success: true, data: { enabled: false, balances: [], transactions: [] }, error: null });
    }

    const [{ rows: balanceRows }, { rows: ledgerRows }, thresholds] = await Promise.all([
      db.query<BalanceRow>(
        `SELECT currency, balance_base_units FROM creator_crypto_balances WHERE user_id = $1`,
        [auth.user.sub]
      ),
      db.query<LedgerRow>(
        `SELECT id, currency, amount_base_units, source_type, reference_id, metadata, created_at
         FROM crypto_balance_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [auth.user.sub]
      ),
      Promise.all(SUPPORTED_CURRENCIES.map(async (c) => [c, (await getCryptoPayoutThreshold(c)).toString()] as const)),
    ]);

    const balances = balanceRows.map((r) => {
      const token = getToken(r.currency as CryptoCurrency);
      return {
        currency: r.currency,
        chain: token.chain,
        balanceBaseUnits: r.balance_base_units,
        decimals: token.decimals,
        thresholdBaseUnits: Object.fromEntries(thresholds)[r.currency] ?? "0",
      };
    });

    const transactions = ledgerRows.map((r) => {
      const chain = getToken(r.currency as CryptoCurrency).chain;
      const txHash = typeof r.metadata?.txHash === "string" ? r.metadata.txHash : null;
      return {
        id: r.id,
        currency: r.currency,
        amountBaseUnits: r.amount_base_units,
        sourceType: r.source_type,
        referenceId: r.reference_id,
        createdAt: r.created_at,
        scanUrl: txHash ? explorerTxUrl(chain, txHash) : null,
      };
    });

    return NextResponse.json({ success: true, data: { enabled: true, balances, transactions }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
