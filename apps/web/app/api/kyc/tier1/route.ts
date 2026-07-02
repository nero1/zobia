export const dynamic = "force-dynamic";

/**
 * POST /api/kyc/tier1
 *
 * Starts a Tier 1 identity verification. Branches on `citizenshipCountry`:
 *   - "NG": Nigeria BVN flow — Paystack identity validation + an uploaded
 *     ID/NIN slip, AI-cross-checked once Paystack's result arrives (async).
 *   - anything else: submitted government ID + proof of address, reviewed
 *     by AI or a human per the admin's `kyc.tier1ReviewMode` setting.
 *
 * Charges `kyc.costCredits` (default 100) credits on submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { submitTier1Nigeria, submitTier1International } from "@/lib/kyc/service";

const nigeriaSchema = z.object({
  citizenshipCountry: z.literal("NG"),
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
  bankCode: z.string().min(1).max(10),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  documentIds: z.array(z.string().uuid()).min(1).max(4),
});

const internationalSchema = z.object({
  citizenshipCountry: z.string().length(2).refine((c) => c.toUpperCase() !== "NG", "Nigerian citizens must use the BVN flow"),
  idType: z.enum(["passport", "drivers_license", "voters_card", "national_id"]),
  idNumber: z.string().min(3).max(64),
  submittedFullName: z.string().min(1).max(200),
  documentIds: z.array(z.string().uuid()).min(2).max(6),
});

const bodySchema = z.union([nigeriaSchema, internationalSchema]);

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("kyc");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, bodySchema);

    // Discriminate on a field unique to the Nigeria branch — citizenshipCountry
    // can't be used as a type guard here since the international schema types
    // it as a plain `string` (any non-"NG" ISO code), not a narrower literal.
    if ("bvn" in body) {
      const { submissionId } = await submitTier1Nigeria(userId, body);
      return NextResponse.json({ success: true, data: { submissionId }, error: null }, { status: 201 });
    }

    const { submissionId } = await submitTier1International(userId, {
      citizenshipCountry: body.citizenshipCountry.toUpperCase(),
      idType: body.idType,
      idNumber: body.idNumber,
      submittedFullName: body.submittedFullName,
      documentIds: body.documentIds,
    });
    return NextResponse.json({ success: true, data: { submissionId }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
