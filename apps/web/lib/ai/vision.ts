/**
 * lib/ai/vision.ts
 *
 * Shared image-classification pipeline used by every image-based AI
 * moderation surface (ad creative images, KYC documents/selfies, and any
 * future image classifier). Consolidates what used to be duplicated,
 * Gemini-only REST calls in lib/moderation/aiClassifier.ts and
 * lib/kyc/geminiVision.ts.
 *
 * Flow:
 *   1. DeepSeek Flash (vision) classifies the image — cheapest, primary.
 *   2. If DeepSeek fails outright, or its confidence is below
 *      `ai_vision_escalate_below_threshold` (default 0.6), escalate to
 *      Gemini as a second opinion.
 *   3. If Gemini also fails or is still below threshold, the image is
 *      flagged `needsHumanReview: true` with both providers' raw results
 *      attached, for a human moderator queue (ad moderators for ads;
 *      existing KYC manual-review queue for KYC).
 *
 * Every attempt is logged via lib/ai/monitoring.ts logAiCall(), including
 * token usage, so it shows up in the centralized Admin AI Monitoring panel.
 */

import { visionChat, getVisionProviderOrder } from "@/lib/ai/client";
import type { AiProviderId } from "@/lib/ai/config";
import { logAiCall } from "@/lib/ai/monitoring";
import { getManifestValue } from "@/lib/manifest";
import { safeFetch } from "@/lib/security/ssrf";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DEFAULT_ESCALATE_BELOW_THRESHOLD = 0.6;

async function getEscalateBelowThreshold(): Promise<number> {
  const raw = await getManifestValue("ai_vision_escalate_below_threshold");
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : DEFAULT_ESCALATE_BELOW_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One provider's raw attempt at classifying an image, for audit/escalation display. */
export interface VisionAttempt {
  provider: AiProviderId | "none";
  model: string;
  success: boolean;
  /** Parsed confidence score (0-1) the model reported, when parseable. */
  confidence: number | null;
  /** Raw text content returned by the model (already truncated for storage). */
  rawContent: string | null;
  errorMessage: string | null;
}

export interface ImageClassificationResult<T> {
  /** The best available parsed result — from whichever provider produced the highest-confidence read. */
  result: T | null;
  /** Which provider's result `result` came from ("none" if every attempt failed/low-confidence). */
  provider: AiProviderId | "none";
  model: string | null;
  confidence: number | null;
  /** True when confidence never cleared the escalation threshold on any provider — route to human review. */
  needsHumanReview: boolean;
  /** Every attempt made, in order, for audit trails / the ad-moderator escalation queue. */
  attempts: VisionAttempt[];
}

interface ClassifyImageOptions<T> {
  /** Image bytes, already fetched and validated. */
  imageBuffer: Buffer;
  mimeType: string;
  /** The instruction/prompt describing what to classify and the expected JSON shape. */
  prompt: string;
  /** Feature tag for ai_call_log, e.g. "vision:ad_creative_image", "vision:kyc_document". */
  feature: string;
  /** Parse the model's raw text response into T; return null if unparseable. Must also read a 0-1 "confidence" field. */
  parse: (raw: string) => { value: T; confidence: number } | null;
  maxTokens?: number;
  /** Sampling temperature (default 0.1 — classification tasks want near-deterministic output). */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Image fetch with guards (SSRF, size cap, MIME allow-list)
// ---------------------------------------------------------------------------

/**
 * Fetch an admin/advertiser-supplied image URL with SSRF protection (via
 * lib/security/ssrf.ts safeFetch), a size cap, and a MIME allow-list.
 * Throws on any violation — callers should treat that as "AI unavailable,
 * escalate to manual review", never as a pass.
 */
export async function fetchImageWithGuards(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await safeFetch(imageUrl, { method: "GET" }, { maxResponseBytes: MAX_IMAGE_BYTES });
  if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error(`Unsupported image content-type: ${contentType || "unknown"}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds max size of ${MAX_IMAGE_BYTES} bytes`);
  }

  return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classify an image, trying vision-capable providers in order (default:
 * DeepSeek → Gemini) and escalating to the next provider only when the
 * current one fails or reports low confidence. Never throws — a total
 * failure comes back as `needsHumanReview: true` with `result: null`.
 */
export async function classifyImage<T>(options: ClassifyImageOptions<T>): Promise<ImageClassificationResult<T>> {
  const order = await getVisionProviderOrder();
  const escalateBelow = await getEscalateBelowThreshold();
  const base64 = options.imageBuffer.toString("base64");

  const attempts: VisionAttempt[] = [];
  let best: { value: T; confidence: number; provider: AiProviderId; model: string } | null = null;

  for (const providerId of order) {
    const startedAt = Date.now();
    try {
      const response = await visionChat(providerId, {
        imageBase64: base64,
        mimeType: options.mimeType,
        prompt: options.prompt,
        maxTokens: options.maxTokens ?? 300,
        temperature: options.temperature ?? 0.1,
      });

      const parsed = options.parse(response.content);
      const confidence = parsed ? Math.max(0, Math.min(1, parsed.confidence)) : null;

      attempts.push({
        provider: providerId,
        model: response.model,
        success: parsed !== null,
        confidence,
        rawContent: response.content.slice(0, 500),
        errorMessage: parsed ? null : "Unparseable AI response",
      });

      await logAiCall({
        provider: providerId,
        model: response.model,
        feature: options.feature,
        success: parsed !== null,
        latencyMs: Date.now() - startedAt,
        confidence,
        resultPreview: response.content.slice(0, 500),
        usage: response.usage
          ? { inputTokens: response.usage.promptTokens, outputTokens: response.usage.completionTokens }
          : undefined,
      });

      if (parsed && (best === null || parsed.confidence > best.confidence)) {
        best = { value: parsed.value, confidence: parsed.confidence, provider: providerId, model: response.model };
      }

      // Confident enough — stop here, no need to escalate further.
      if (parsed && parsed.confidence >= escalateBelow) {
        return {
          result: parsed.value,
          provider: providerId,
          model: response.model,
          confidence: parsed.confidence,
          needsHumanReview: false,
          attempts,
        };
      }
      // Otherwise fall through and try the next provider (escalation).
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, provider: providerId, feature: options.feature }, "[ai:vision] classification attempt failed");
      attempts.push({ provider: providerId, model: "n/a", success: false, confidence: null, rawContent: null, errorMessage: message });
      await logAiCall({
        provider: providerId,
        model: "n/a",
        feature: options.feature,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
      });
    }
  }

  // Every provider either failed or came back below threshold — human review.
  return {
    result: best?.value ?? null,
    provider: best?.provider ?? "none",
    model: best?.model ?? null,
    confidence: best?.confidence ?? null,
    needsHumanReview: true,
    attempts,
  };
}
