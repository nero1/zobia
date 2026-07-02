/**
 * lib/kyc/aiNameMatch.ts
 *
 * AI-assisted name matching for KYC Tier 1: compares the name returned by an
 * identity source (Paystack BVN lookup, or OCR'd from a submitted ID) against
 * the name the user typed on the submission form. Handles the fuzzy cases a
 * strict string-equality check would wrongly reject — middle-name order,
 * nicknames, transliteration, missing honorifics, minor typos — while still
 * flagging genuinely different identities.
 *
 * Uses the platform's existing DeepSeek-primary/Gemini-fallback text client
 * (lib/ai/client.ts). Text-only — no image handling here (see geminiVision.ts
 * for document/selfie analysis).
 */

import { aiClient } from "@/lib/ai/client";
import { logger } from "@/lib/logger";

export interface NameMatchResult {
  /** 0 (no relation) to 1 (same person, high confidence). */
  score: number;
  match: boolean;
  reasoning: string;
}

const SYSTEM_PROMPT =
  "You compare two full names to judge whether they plausibly belong to the same " +
  "person, for identity-verification purposes. Account for name order (first/last " +
  "swapped), missing/extra middle names, common nicknames, transliteration and " +
  "spelling variants, and honorifics (Mr/Mrs/Dr/Alhaji etc). Respond with ONLY a " +
  "JSON object, no markdown, no commentary: " +
  '{"score": <number 0-1>, "match": <boolean>, "reasoning": "<one short sentence>"}. ' +
  "score reflects your confidence the two names refer to the same individual.";

/** Best-effort JSON extraction — strips markdown code fences some models add despite instructions. */
function parseJsonResponse(content: string): NameMatchResult | null {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<NameMatchResult>;
    if (typeof parsed.score !== "number") return null;
    const score = Math.max(0, Math.min(1, parsed.score));
    return {
      score,
      match: typeof parsed.match === "boolean" ? parsed.match : score >= 0.7,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

/**
 * Compare two full names via AI and return a confidence score.
 * Falls back to a conservative Levenshtein-adjacent heuristic if the AI
 * providers are both unavailable (circuit open) or return unparseable output,
 * so a KYC submission never gets stuck when AI is down — it just always
 * escalates to manual review instead of auto-approving.
 */
export async function compareNames(nameA: string, nameB: string): Promise<NameMatchResult> {
  const a = nameA.trim();
  const b = nameB.trim();
  if (!a || !b) return { score: 0, match: false, reasoning: "One or both names were empty." };
  if (a.toLowerCase() === b.toLowerCase()) {
    return { score: 1, match: true, reasoning: "Exact match." };
  }

  try {
    const response = await aiClient.chat(
      [{ role: "user", content: `Name A: "${a}"\nName B: "${b}"` }],
      { systemPrompt: SYSTEM_PROMPT, temperature: 0, maxTokens: 200 }
    );
    const parsed = parseJsonResponse(response.content);
    if (parsed) return parsed;
    logger.warn({ content: response.content }, "[kyc/aiNameMatch] Unparseable AI response — falling back to heuristic");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[kyc/aiNameMatch] AI call failed — falling back to heuristic");
  }

  return heuristicNameMatch(a, b);
}

/** Token-overlap heuristic fallback — deliberately conservative (never auto-approves on its own). */
function heuristicNameMatch(a: string, b: string): NameMatchResult {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  const denom = Math.max(tokensA.size, tokensB.size, 1);
  const score = Math.min(0.6, shared / denom); // capped below auto-approve territory
  return {
    score,
    match: false, // heuristic path never self-certifies a match — always escalate
    reasoning: `AI unavailable — heuristic token overlap ${shared}/${denom} (escalated to manual review).`,
  };
}
