/**
 * lib/kyc/geminiVision.ts
 *
 * Vision helper for KYC document/selfie analysis. Despite the filename
 * (kept for import-path stability across the KYC module), this now goes
 * through the shared image-classification pipeline (lib/ai/vision.ts):
 * DeepSeek Flash (vision) first, escalating to Gemini Vision when DeepSeek
 * fails or is low-confidence — the same DeepSeek-primary/Gemini-fallback
 * chain used for ad creative images.
 *
 * Callers must treat a `null` return as "AI unavailable, escalate to manual
 * review" — see lib/kyc/service.ts, which layers its own auto-approve /
 * escalate-below thresholds on top of the confidence this returns.
 */

import { classifyImage } from "@/lib/ai/vision";
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

function parseDocumentResponse(content: string): { value: DocumentAnalysisResult; confidence: number } | null {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<DocumentAnalysisResult>;
    if (typeof parsed.confidence !== "number") return null;
    const confidence = Math.max(0, Math.min(1, parsed.confidence));
    return {
      value: {
        extractedName: typeof parsed.extractedName === "string" ? parsed.extractedName : null,
        documentType: typeof parsed.documentType === "string" ? parsed.documentType : null,
        confidence,
        tamperingSuspected: parsed.tamperingSuspected === true,
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
      },
      confidence,
    };
  } catch {
    return null;
  }
}

/**
 * Analyze a KYC document image (govt ID, proof of address, selfie).
 * Returns null on total failure (no provider could be reached, or none
 * returned a parseable response) — callers must treat null as "escalate to
 * manual review", never as an implicit pass or fail. A low-but-parseable
 * confidence score is still returned (not null) — lib/kyc/service.ts is
 * responsible for the auto-approve / escalate-below-threshold decision.
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
  const prompt = promptHint ? `${DOCUMENT_PROMPT}\n\nContext: ${promptHint}` : DOCUMENT_PROMPT;

  try {
    const classification = await classifyImage({
      imageBuffer,
      mimeType,
      prompt,
      feature: "kyc:document_analysis",
      parse: parseDocumentResponse,
      maxTokens: 300,
      temperature: 0,
    });
    return classification.result;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[kyc/geminiVision] Document analysis failed");
    return null;
  }
}
