/**
 * lib/kyc/geminiVision.ts
 *
 * Gemini Vision helper for KYC document/selfie analysis.
 *
 * The platform's shared AI client (lib/ai/client.ts) is text-only (see its
 * ChatMessage.content: string), so this is a standalone, narrowly-scoped
 * caller straight to the Gemini `generateContent` REST API with inline image
 * data — reusing the same GEMINI_API_KEY / manifest-override lookup and model
 * config (lib/ai/config.ts) as the shared client, but no circuit breaker or
 * DeepSeek fallback, since DeepSeek has no vision endpoint. Callers should
 * treat failures as "AI unavailable" and escalate to manual review — see
 * lib/kyc/service.ts.
 */

import { env } from "@/lib/env";
import { getManifestValue } from "@/lib/manifest";
import { GEMINI_CONFIG, GEMINI_MODELS } from "@/lib/ai/config";
import { logger } from "@/lib/logger";

export interface DocumentAnalysisResult {
  /** Best-effort full name as printed on the document. */
  extractedName: string | null;
  /** Best-effort document type guess (e.g. "national_id", "passport", "utility_bill"). */
  documentType: string | null;
  /** 0-1 confidence this is a genuine, legible, unaltered document. */
  confidence: number;
  /** True if the image shows signs of tampering, screen photography of another photo, or is clearly not a document. */
  tamperingSuspected: boolean;
  notes: string;
}

const DOCUMENT_PROMPT =
  "You are assisting a KYC (identity verification) review queue. Look at this " +
  "image of a submitted document and extract what you can. Respond with ONLY a " +
  "JSON object, no markdown: " +
  '{"extractedName": <string|null>, "documentType": <string|null>, ' +
  '"confidence": <number 0-1>, "tamperingSuspected": <boolean>, "notes": "<short sentence>"}. ' +
  "confidence should be LOW if the image is blurry, cropped, a screenshot of a screen, " +
  "or otherwise not clearly a genuine physical/digital ID or address document. " +
  "Never guess a name you cannot actually read in the image — return null instead.";

async function getApiKey(): Promise<string | null> {
  const override = await getManifestValue("ai_gemini_api_key_override");
  const raw = (override && override.length > 0 ? override : env.GEMINI_API_KEY) ?? null;
  if (!raw) return null;
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

function parseJsonResponse(content: string): DocumentAnalysisResult | null {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<DocumentAnalysisResult>;
    if (typeof parsed.confidence !== "number") return null;
    return {
      extractedName: typeof parsed.extractedName === "string" ? parsed.extractedName : null,
      documentType: typeof parsed.documentType === "string" ? parsed.documentType : null,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      tamperingSuspected: parsed.tamperingSuspected === true,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch {
    return null;
  }
}

/**
 * Analyze a KYC document image (govt ID, proof of address, selfie) with
 * Gemini Vision. Returns null on any failure (missing key, network error,
 * unparseable response) — callers must treat null as "escalate to manual
 * review", never as an implicit pass or fail.
 *
 * @param imageBuffer - Raw image bytes
 * @param mimeType    - e.g. "image/jpeg", "image/png"
 * @param promptHint  - Optional extra context, e.g. "This should be a Nigerian NIN slip."
 */
export async function analyzeDocument(
  imageBuffer: Buffer,
  mimeType: string,
  promptHint?: string
): Promise<DocumentAnalysisResult | null> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    logger.warn("[kyc/geminiVision] No Gemini API key configured — skipping AI document analysis");
    return null;
  }

  const model = GEMINI_MODELS.FLASH;
  const url = `${GEMINI_CONFIG.apiBaseUrl}/models/${model}:generateContent?key=${apiKey}`;
  const base64 = imageBuffer.toString("base64");
  const prompt = promptHint ? `${DOCUMENT_PROMPT}\n\nContext: ${promptHint}` : DOCUMENT_PROMPT;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_CONFIG.timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 300 },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn({ status: res.status }, "[kyc/geminiVision] Gemini API error");
      return null;
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    return parseJsonResponse(text);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[kyc/geminiVision] Document analysis failed");
    return null;
  }
}
