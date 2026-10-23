import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import {
  automationOverview,
  automationJobInput,
  createAutomationAccount,
  saveAutomationJob,
  reviewAutomationGeneration,
} from "@/lib/automation/service";
export const dynamic = "force-dynamic";
export const GET = withAdminAuth(async (_req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    return NextResponse.json({
      success: true,
      data: await automationOverview(),
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("account"),
    username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/),
    displayName: z.string().trim().min(2).max(60),
  }),
  z.object({
    action: z.literal("accountEnabled"),
    id: z.string().uuid(),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal("job"), job: automationJobInput }),
  z.object({
    action: z.literal("review"),
    id: z.string().uuid(),
    approved: z.boolean(),
    title: z.string().min(2).max(150).optional(),
    body: z.string().min(20).max(40000).optional(),
    reason: z.string().max(2000).optional(),
  }),
]);
export const POST = withAdminAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, input);
    let data: unknown;
    if (body.action === "account") data = await createAutomationAccount(body);
    else if (body.action === "job") data = await saveAutomationJob(body.job);
    else if (body.action === "review")
      data = await reviewAutomationGeneration(
        body.id,
        body.approved,
        auth.user.sub,
        body,
      );
    else {
      const db = await getDb();
      await db
        .update(schema.automationAccounts)
        .set({ enabled: body.enabled })
        .where(eq(schema.automationAccounts.userId, body.id));
      data = { updated: true };
    }
    return NextResponse.json({ success: true, data, error: null });
  } catch (error) {
    return handleApiError(error);
  }
});
