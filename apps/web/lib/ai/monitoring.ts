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

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import type { AiProviderId } from "./config";

// NOTE (schema gap): `ai_call_log` has no corresponding pgTable in
// lib/db/schema.ts, so this module cannot use the Drizzle query builder for
// it. Queries below run through Drizzle's `sql` tagged template via
// getDb().execute()/orm.execute() — still the shared Drizzle-wrapped pg.Pool,
// still fully parameterised — rather than the legacy raw-SQL adapter from @/lib/db.

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
  /** Token usage, when the provider's response includes it — powers the AI Monitoring panel's usage/cost estimates. */
  usage?: { inputTokens?: number; outputTokens?: number } | null;
  /**
   * Extra structured detail for the AI Monitoring panel's "details" drawer —
   * e.g. which prompt/pipeline version, escalation chain, or subject id.
   * Never put raw PII or full user content here (same rule as resultPreview).
   */
  metadata?: Record<string, unknown> | null;
}

/** Insert one row into the rotating AI call log. Never throws — logging must not break the caller. */
export async function logAiCall(input: LogAiCallInput): Promise<void> {
  try {
    const orm = await getDb();
    await orm.execute(sql`
      INSERT INTO ai_call_log (provider, model, feature, success, confidence, latency_ms, result_preview, error_message, input_tokens, output_tokens, metadata)
       VALUES (${input.provider}, ${input.model}, ${input.feature}, ${input.success}, ${input.confidence ?? null}, ${Math.round(input.latencyMs)}, ${input.resultPreview ? input.resultPreview.slice(0, RESULT_PREVIEW_MAX_LENGTH) : null}, ${input.errorMessage ? input.errorMessage.slice(0, RESULT_PREVIEW_MAX_LENGTH) : null}, ${input.usage?.inputTokens ?? null}, ${input.usage?.outputTokens ?? null}, ${input.metadata ? JSON.stringify(input.metadata) : null})
    `);
  } catch (err) {
    logger.error({ err, feature: input.feature }, "[ai:monitoring] failed to write ai_call_log entry (non-fatal)");
  }
}

/** Delete rows older than 48 hours. Called by the rotate-ai-call-log cron route. */
export async function pruneAiCallLog(): Promise<number> {
  const orm = await getDb();
  const result = await orm.execute(sql`DELETE FROM ai_call_log WHERE created_at < NOW() - INTERVAL '48 hours'`);
  return result.rowCount ?? 0;
}

export type AiCallLogRow = {
  id: string;
  provider: string;
  model: string;
  feature: string;
  success: boolean;
  confidence: number | null;
  latency_ms: number;
  result_preview: string | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** Recent calls for the admin AI Settings / AI Monitoring panels. Optionally filtered by feature prefix (e.g. "moderation:", "kyc:", "vision:"). */
export async function getRecentAiCalls(limit = 100, featurePrefix?: string): Promise<AiCallLogRow[]> {
  const orm = await getDb();
  const cappedLimit = Math.min(limit, 500);
  const prefix = featurePrefix ?? null;
  const result = await orm.execute<AiCallLogRow>(sql`
    SELECT id, provider, model, feature, success, confidence, latency_ms, result_preview, error_message,
            input_tokens, output_tokens, metadata, created_at
     FROM ai_call_log
     WHERE ${prefix}::text IS NULL OR feature LIKE ${prefix} || '%'
     ORDER BY created_at DESC
     LIMIT ${cappedLimit}
  `);
  return result.rows;
}

export interface AiUsageStats {
  feature: string;
  provider: string;
  callCount: number;
  successCount: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** Aggregate usage/token stats over the retained 48-hour window, grouped by feature + provider, for the Admin AI Monitoring panel. */
export async function getAiUsageStats(): Promise<AiUsageStats[]> {
  const orm = await getDb();
  const result = await orm.execute<{
    feature: string;
    provider: string;
    call_count: string;
    success_count: string;
    avg_latency_ms: string | null;
    total_input_tokens: string | null;
    total_output_tokens: string | null;
  }>(sql`
    SELECT feature, provider,
            COUNT(*) AS call_count,
            COUNT(*) FILTER (WHERE success) AS success_count,
            AVG(latency_ms) AS avg_latency_ms,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens
     FROM ai_call_log
     GROUP BY feature, provider
     ORDER BY feature, provider
  `);
  return result.rows.map((r) => ({
    feature: r.feature,
    provider: r.provider,
    callCount: parseInt(r.call_count, 10),
    successCount: parseInt(r.success_count, 10),
    avgLatencyMs: r.avg_latency_ms ? Math.round(parseFloat(r.avg_latency_ms)) : 0,
    totalInputTokens: parseInt(r.total_input_tokens ?? "0", 10),
    totalOutputTokens: parseInt(r.total_output_tokens ?? "0", 10),
  }));
}
