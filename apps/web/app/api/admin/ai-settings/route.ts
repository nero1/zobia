export const dynamic = "force-dynamic";

/**
 * app/api/admin/ai-settings/route.ts
 *
 * GET  /api/admin/ai-settings
 *   Returns current status for every configured AI provider (DeepSeek,
 *   Gemini, Groq — see lib/ai/config.ts AI_PROVIDERS): active key source,
 *   masked key preview, selected model, and circuit breaker state.
 *
 * PUT  /api/admin/ai-settings
 *   Save or clear an API key override for a provider.
 *   Stored in x_manifest under `<provider>.apiKeyManifestKey`. Empty string
 *   clears the override (env var used).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getManifestValue, invalidateManifestCache } from "@/lib/manifest";
import { getProviderCircuitState } from "@/lib/ai/client";
import { AI_PROVIDERS, CIRCUIT_BREAKER, type AiProviderId } from "@/lib/ai/config";
import { env } from "@/lib/env";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskKey(key: string | null | undefined): string | null {
  if (!key || key.length < 4) return null;
  return `...${key.slice(-4)}`;
}

const PROVIDER_ENV_KEYS: Record<AiProviderId, string | undefined> = {
  deepseek: env.DEEPSEEK_API_KEY,
  gemini: env.GEMINI_API_KEY,
  groq: env.GROQ_API_KEY,
};

// ---------------------------------------------------------------------------
// GET /api/admin/ai-settings
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(
  async (_req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
    try {
      const toCircuitStatus = (openedAt: number | null): "closed" | "open" | "half-open" => {
        if (openedAt === null) return "closed";
        return Date.now() - openedAt >= CIRCUIT_BREAKER.recoveryTimeMs ? "half-open" : "open";
      };

      const providerIds = Object.keys(AI_PROVIDERS) as AiProviderId[];
      const data: Record<string, unknown> = {};

      await Promise.all(
        providerIds.map(async (id) => {
          const meta = AI_PROVIDERS[id];
          const [override, modelOverride, circuit] = await Promise.all([
            getManifestValue(meta.apiKeyManifestKey),
            getManifestValue(meta.modelManifestKey),
            getProviderCircuitState(id),
          ]);
          const keySource: "env" | "override" = override && override.length > 0 ? "override" : "env";
          const activeKey = keySource === "override" ? override : PROVIDER_ENV_KEYS[id];

          data[id] = {
            keySource,
            keyMasked: maskKey(activeKey),
            selectedModel: modelOverride && modelOverride.length > 0 ? modelOverride : meta.defaultModel,
            supportedModels: meta.supportedModels,
            circuit: {
              status: toCircuitStatus(circuit.openedAt),
              failures: circuit.failures,
              openedAt: circuit.openedAt,
            },
          };
        })
      );

      const providerOrder = await getManifestValue("ai_provider_order");

      return NextResponse.json({
        success: true,
        data: { ...data, providerOrder: providerOrder ?? "deepseek,gemini,groq" },
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
  provider: z.enum(["deepseek", "gemini", "groq"]),
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
      const manifestKey = AI_PROVIDERS[provider].apiKeyManifestKey;

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
