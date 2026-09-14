export const dynamic = 'force-dynamic';

/**
 * /api/admin/payments/contexts
 *
 * Per payment-context Paystack / crypto-currency / free toggles.
 *
 * GET   — list every context's current settings.
 * PATCH — update one or more contexts at once (batch-edit UI on
 *         gate44/payments): body is either a single
 *         { contextKey, paystackEnabled?, cryptoEnabledCurrencies?, isFree? }
 *         or { contextKeys: string[], patch: {...} } for a bulk action
 *         ("turn off crypto for selected", "mark selected free", etc).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import {
  PAYMENT_CONTEXT_KEYS,
  PAYMENT_CONTEXT_LABELS,
  getAllPaymentContextSettings,
  updatePaymentContextSettings,
} from "@/lib/payments/contextSettings";
import { SUPPORTED_CURRENCIES } from "@/lib/payments/crypto/tokens";

export const GET = withAdminAuth(async () => {
  try {
    const settings = await getAllPaymentContextSettings();
    return NextResponse.json({
      success: true,
      data: settings.map((s) => ({ ...s, label: PAYMENT_CONTEXT_LABELS[s.contextKey] })),
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

const patchFieldsSchema = z.object({
  paystackEnabled: z.boolean().optional(),
  cryptoEnabledCurrencies: z.array(z.enum(SUPPORTED_CURRENCIES as [string, ...string[]])).optional(),
  isFree: z.boolean().optional(),
});

const PatchSchema = z.union([
  patchFieldsSchema.extend({ contextKey: z.enum(PAYMENT_CONTEXT_KEYS) }),
  z.object({
    contextKeys: z.array(z.enum(PAYMENT_CONTEXT_KEYS)).min(1),
    patch: patchFieldsSchema,
  }),
]);

export const PATCH = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, PatchSchema);

    const contextKeys = "contextKeys" in body ? body.contextKeys : [body.contextKey];
    const patch = "contextKeys" in body ? body.patch : body;
    if (contextKeys.length === 0) throw badRequest("No contexts specified");

    for (const key of contextKeys) {
      await updatePaymentContextSettings(
        key,
        {
          paystackEnabled: patch.paystackEnabled,
          cryptoEnabledCurrencies: patch.cryptoEnabledCurrencies as never,
          isFree: patch.isFree,
        },
        auth.user.sub
      );
    }

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_payment_context_updated",
      targetType: "payment_context_settings",
      targetId: contextKeys.join(","),
      metadata: { contextKeys, patch },
    });

    const settings = await getAllPaymentContextSettings();
    return NextResponse.json({
      success: true,
      data: settings.map((s) => ({ ...s, label: PAYMENT_CONTEXT_LABELS[s.contextKey] })),
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
