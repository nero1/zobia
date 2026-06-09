export const dynamic = "force-dynamic";

/**
 * app/api/admin/ai-settings/test/route.ts
 *
 * POST /api/admin/ai-settings/test
 *   Sends a minimal live ping to a provider to verify connectivity and the
 *   active API key. Optionally accepts a key to test before saving.
 *
 *   Always returns HTTP 200. Inspect `data.success` in the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testDeepSeekConnection, testGeminiConnection } from "@/lib/ai/client";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

const testSchema = z.object({
  provider: z.enum(["deepseek", "gemini"]),
  apiKey: z.string().max(256).optional(),
});

export const POST = withAdminAuth(
  async (req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
    try {
      const body = await req.json();
      const parsed = testSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, data: null, error: "Invalid request body" },
          { status: 400 }
        );
      }

      const { provider, apiKey } = parsed.data;
      const start = Date.now();

      try {
        const result =
          provider === "deepseek"
            ? await testDeepSeekConnection(apiKey)
            : await testGeminiConnection(apiKey);

        return NextResponse.json({
          success: true,
          data: {
            provider,
            latencyMs: Date.now() - start,
            model: result.model,
          },
          error: null,
        });
      } catch (testErr) {
        const message =
          testErr instanceof Error ? testErr.message : "Unknown error";
        return NextResponse.json({
          success: false,
          data: {
            provider,
            latencyMs: Date.now() - start,
            error: message,
          },
          error: null,
        });
      }
    } catch (err) {
      return handleApiError(err);
    }
  }
);
