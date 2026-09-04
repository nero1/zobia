/**
 * lib/ai/monitoring.ts
 *
 * A 48-hour rotating log of AI provider calls (ai_call_log table). Not
 * wired automatically into lib/ai/client.ts — callers that already know
 * the "feature" they're using AI for and can compute a confidence score
 * (lib/moderation/aiClassifier.ts, lib/kyc/aiNameMatch.ts,
 * lib/kyc/geminiVision.ts) call `logAiCall()` directly after the request.
 * When adding a new AI-backed feature, call it too so it shows up in
 * Admin > AI Settings > Recent Calls.
 *
 * Rotation: app/api/cron/rotate-ai-call-log/route.ts deletes rows older
 * than 48 hours. Run externally (Vercel Hobby only allows daily crons) —
 * see docs/HOW-IT-WORKS.md for the recommended external schedule.
 *
 * @module lib/ai/monitoring
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { AiProviderId } from "./config";

const RESULT_PREVIEW_MAX_LENGTH = 500;

export interface LogAiCallInput {
  provider: AiProviderId | "none";
  model: string;
  /** Short identifier for the feature/call-site, e.g. "moderation:report", "kyc:name_match". */
  feature: string;
  success: boolean;
  latencyMs: number;
  /** 0-1 confidence score, when the feature computes one. */
  confidence?: number | null;
  /** Truncated preview of the model's output or decision — never store raw PII/full documents. */
  resultPreview?: string | null;
  errorMessage?: string | null;
}

/** Insert one row into the rotating AI call log. Never throws — logging must not break the caller. */
export async function logAiCall(input: LogAiCallInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO ai_call_log (provider, model, feature, success, confidence, latency_ms, result_preview, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.provider,
        input.model,
        input.feature,
        input.success,
        input.confidence ?? null,
        Math.round(input.latencyMs),
        input.resultPreview ? input.resultPreview.slice(0, RESULT_PREVIEW_MAX_LENGTH) : null,
        input.errorMessage ? input.errorMessage.slice(0, RESULT_PREVIEW_MAX_LENGTH) : null,
      ]
    );
  } catch (err) {
    logger.error({ err, feature: input.feature }, "[ai:monitoring] failed to write ai_call_log entry (non-fatal)");
  }
}

/** Delete rows older than 48 hours. Called by the rotate-ai-call-log cron route. */
export async function pruneAiCallLog(): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM ai_call_log WHERE created_at < NOW() - INTERVAL '48 hours'`);
  return rowCount ?? 0;
}

export interface AiCallLogRow {
  id: string;
  provider: string;
  model: string;
  feature: string;
  success: boolean;
  confidence: number | null;
  latency_ms: number;
  result_preview: string | null;
  error_message: string | null;
  created_at: string;
}

/** Recent calls for the admin AI Settings monitoring panel. */
export async function getRecentAiCalls(limit = 100): Promise<AiCallLogRow[]> {
  const { rows } = await db.query<AiCallLogRow>(
    `SELECT id, provider, model, feature, success, confidence, latency_ms, result_preview, error_message, created_at
     FROM ai_call_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(limit, 500)]
  );
  return rows;
}
