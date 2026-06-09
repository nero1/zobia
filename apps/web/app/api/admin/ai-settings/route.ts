export const dynamic = "force-dynamic";

/**
 * app/api/admin/ai-settings/route.ts
 *
 * GET  /api/admin/ai-settings
 *   Returns current status for DeepSeek and Gemini: active key source,
 *   masked key preview, and DeepSeek circuit breaker state.
 *
 * PUT  /api/admin/ai-settings
 *   Save or clear an API key override for a provider.
 *   Stored in x_manifest under ai_deepseek_api_key_override or
 *   ai_gemini_api_key_override. Empty string clears the override (env var used).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getManifestValue, invalidateManifestCache } from "@/lib/manifest";
import { getDeepSeekCircuitState } from "@/lib/ai/client";
import { env } from "@/lib/env";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { CIRCUIT_BREAKER } from "@/lib/ai/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskKey(key: string | null | undefined): string | null {
  if (!key || key.length < 4) return null;
  return `...${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// GET /api/admin/ai-settings
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(
  async (_req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
    try {
      const [deepseekOverride, geminiOverride] = await Promise.all([
        getManifestValue("ai_deepseek_api_key_override"),
        getManifestValue("ai_gemini_api_key_override"),
      ]);

      const deepseekKeySource: "env" | "override" =
        deepseekOverride && deepseekOverride.length > 0 ? "override" : "env";
      const geminiKeySource: "env" | "override" =
        geminiOverride && geminiOverride.length > 0 ? "override" : "env";

      const activeDeepSeekKey =
        deepseekKeySource === "override" ? deepseekOverride : env.DEEPSEEK_API_KEY;
      const activeGeminiKey =
        geminiKeySource === "override" ? geminiOverride : env.GEMINI_API_KEY;

      // Circuit breaker status
      const circuit = getDeepSeekCircuitState();
      let circuitStatus: "closed" | "open" | "half-open" = "closed";
      if (circuit.openedAt !== null) {
        const elapsed = Date.now() - circuit.openedAt;
        circuitStatus = elapsed >= CIRCUIT_BREAKER.recoveryTimeMs ? "half-open" : "open";
      }

      return NextResponse.json({
        success: true,
        data: {
          deepseek: {
            keySource: deepseekKeySource,
            keyMasked: maskKey(activeDeepSeekKey),
            circuit: {
              status: circuitStatus,
              failures: circuit.failures,
              openedAt: circuit.openedAt,
            },
          },
          gemini: {
            keySource: geminiKeySource,
            keyMasked: maskKey(activeGeminiKey),
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/admin/ai-settings
// ---------------------------------------------------------------------------

const updateKeySchema = z.object({
  provider: z.enum(["deepseek", "gemini"]),
  apiKey: z.string().max(256),
});

export const PUT = withAdminAuth(
  async (req: NextRequest, ctx: { params: Record<string, string>; auth: AdminContext }) => {
    try {
      const body = await req.json();
      const parsed = updateKeySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, data: null, error: "Invalid request body" },
          { status: 400 }
        );
      }

      const { provider, apiKey } = parsed.data;
      const manifestKey =
        provider === "deepseek"
          ? "ai_deepseek_api_key_override"
          : "ai_gemini_api_key_override";

      // Read existing value for audit log
      const existing = await getManifestValue(manifestKey);

      // Upsert into x_manifest
      await db.query(
        `INSERT INTO x_manifest (key, value, description, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = EXCLUDED.updated_at`,
        [
          manifestKey,
          apiKey,
          `Admin-managed API key override for ${provider}`,
        ]
      );

      // Audit log — store only masked values, never the real key
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.auth.user.sub,
          "update_ai_key",
          "x_manifest",
          manifestKey,
          JSON.stringify({ keyMasked: maskKey(existing) }),
          JSON.stringify({ keyMasked: apiKey.length > 0 ? maskKey(apiKey) : null }),
          req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
        ]
      );

      await invalidateManifestCache();

      const keySource: "env" | "override" = apiKey.length > 0 ? "override" : "env";

      return NextResponse.json({
        success: true,
        data: { provider, keySource },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
