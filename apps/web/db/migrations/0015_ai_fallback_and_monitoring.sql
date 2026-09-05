-- 0015_ai_fallback_and_monitoring.sql
--
-- 3rd AI fallback tier (Groq) + per-provider model selection + a rotating
-- 48h log of every AI provider call for monitoring (see lib/ai/config.ts,
-- lib/ai/client.ts, lib/ai/monitoring.ts).

-- ---------------------------------------------------------------------------
-- Admin-configurable fallback order and per-provider model selection.
-- Empty string means "use the built-in default model" (see AI_PROVIDERS in
-- lib/ai/config.ts) — these rows exist so /api/admin/config/[key] (which
-- only allows updating pre-existing keys) can edit them from AI Settings.
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
    ('ai_provider_order', 'deepseek,gemini,groq', 'Comma-separated AI provider fallback order.'),
    ('ai_deepseek_model', '', 'Selected DeepSeek model. Empty = provider default.'),
    ('ai_gemini_model', '', 'Selected Gemini model. Empty = provider default.'),
    ('ai_groq_model', '', 'Selected Groq model. Empty = provider default (GPT-OSS 120B).')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 48-hour rotating call log — every AI provider call a feature explicitly
-- logs via lib/ai/monitoring.ts logAiCall(). Rotated by the
-- rotate-ai-call-log cron route (external scheduler — see docs/HOW-IT-WORKS.md).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_call_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    provider text NOT NULL,
    model text NOT NULL,
    feature text NOT NULL,
    success boolean NOT NULL,
    confidence numeric(5,4),
    latency_ms integer NOT NULL,
    result_preview text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_created_at ON ai_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_feature ON ai_call_log(feature, created_at DESC);
