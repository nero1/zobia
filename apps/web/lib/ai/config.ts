/**
 * lib/ai/config.ts
 *
 * Central AI model configuration.
 *
 * All model identifiers and provider settings live here.
 * The AI client imports from this file – never hardcodes strings elsewhere.
 */

// ---------------------------------------------------------------------------
// DeepSeek (primary provider)
// ---------------------------------------------------------------------------

export const DEEPSEEK_MODELS = {
  /**
   * DeepSeek Flash — the current default model. As of DeepSeek-V4.1-Flash
   * (Sept 2026) this single model handles both text chat AND native image
   * understanding (multimodal), so it is used for text moderation AND as the
   * primary image classifier (see lib/ai/vision.ts). The legacy
   * `deepseek-chat` / `deepseek-v4-flash` aliases still resolve server-side
   * to this model.
   */
  FLASH: "deepseek-flash",
  /** Legacy alias, still accepted by the API — kept selectable for admins pinned to it. */
  CHAT: "deepseek-chat",
  /** Code generation and analysis. */
  CODER: "deepseek-coder",
  /** Reasoning model (chain-of-thought). Text-only — no vision support. */
  REASONER: "deepseek-reasoner",
} as const;

export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];

export const DEEPSEEK_CONFIG = {
  /** Default model for most tasks (text AND vision — see DEEPSEEK_MODELS.FLASH). */
  defaultModel: DEEPSEEK_MODELS.FLASH,
  /** Max tokens to generate in a single response. */
  maxTokens: 4096,
  /** Default temperature for chat completions. */
  temperature: 0.7,
  /** Request timeout in milliseconds. */
  timeoutMs: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Gemini (fallback provider)
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = {
  /**
   * Latest free-tier-enabled, image-capable Gemini model (Gemini 3.6 Flash,
   * shipped July 2026 — multimodal: text, image, audio, video). Used as the
   * fallback/escalation model for all image classification (ad creatives,
   * KYC documents) and as the 2nd-level text fallback.
   */
  FLASH: "gemini-3.6-flash",
  /** Gemini 3.5 Flash-Lite — lower-latency, lower-cost alternative, still multimodal + free-tier. */
  FLASH_LITE: "gemini-3.5-flash-lite",
  /** Gemini 3 Pro (higher capacity, paid tier only — admin-selectable but not free). */
  PRO: "gemini-3-pro",
  /** Legacy models kept selectable in case an admin's account/region hasn't rolled onto Gemini 3 yet. */
  LEGACY_FLASH_2_0: "gemini-2.0-flash-exp",
  LEGACY_FLASH_1_5: "gemini-1.5-flash",
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

export const GEMINI_CONFIG = {
  /** Default fallback + vision-escalation model. Prefer Flash for cost, speed, and free-tier availability. */
  defaultModel: GEMINI_MODELS.FLASH,
  /** Gemini REST API base URL. */
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  maxTokens: 4096,
  temperature: 0.7,
  timeoutMs: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Groq (3rd-level fallback provider) — OpenAI-compatible REST API, no SDK
// dependency (matches the raw-fetch style of the DeepSeek/Gemini adapters).
// ---------------------------------------------------------------------------

export const GROQ_MODELS = {
  /** Default: strong general-purpose open-weights model. */
  GPT_OSS_120B: "openai/gpt-oss-120b",
  /** Faster/cheaper alternative — admin-selectable in AI Settings. */
  LLAMA_3_1_8B_INSTANT: "llama-3.1-8b-instant",
} as const;

export type GroqModel = (typeof GROQ_MODELS)[keyof typeof GROQ_MODELS];

export const GROQ_CONFIG = {
  defaultModel: GROQ_MODELS.GPT_OSS_120B as string,
  apiBaseUrl: "https://api.groq.com/openai/v1",
  maxTokens: 4096,
  temperature: 0.7,
  timeoutMs: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Provider registry — the single place that knows every AI provider and the
// models an admin may pick between for it. To add a new provider or model:
//   1. Add its model constants + *_CONFIG above (or a new provider block).
//   2. Add an entry to AI_PROVIDERS below.
//   3. Add a matching adapter function in lib/ai/client.ts and register it
//      in the PROVIDER_ADAPTERS map there.
// No other file needs to change — the admin AI Settings page, the fallback
// loop, and the manifest-driven model/provider-order config all read from
// this registry.
// ---------------------------------------------------------------------------

export type AiProviderId = "deepseek" | "gemini" | "groq";

export interface AiProviderMeta {
  id: AiProviderId;
  label: string;
  /** Models an admin may choose between for this provider, in display order. */
  supportedModels: { id: string; label: string }[];
  defaultModel: string;
  /** x_manifest key holding the admin's currently-selected model, if overridden. */
  modelManifestKey: string;
  /** x_manifest key holding the admin's API key override. */
  apiKeyManifestKey: string;
  /** Whether this provider can classify images (multimodal vision input). */
  supportsVision: boolean;
  /**
   * Models an admin may choose between for IMAGE classification specifically.
   * Present only for vision-capable providers. Falls back to `defaultVisionModel`.
   */
  visionModels?: { id: string; label: string }[];
  defaultVisionModel?: string;
  /** x_manifest key holding the admin's selected vision model, if overridden. */
  visionModelManifestKey?: string;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    supportedModels: [
      { id: DEEPSEEK_MODELS.FLASH, label: "DeepSeek Flash (text + vision)" },
      { id: DEEPSEEK_MODELS.CHAT, label: "DeepSeek Chat (legacy alias)" },
      { id: DEEPSEEK_MODELS.REASONER, label: "DeepSeek Reasoner" },
    ],
    defaultModel: DEEPSEEK_CONFIG.defaultModel,
    modelManifestKey: "ai_deepseek_model",
    apiKeyManifestKey: "ai_deepseek_api_key_override",
    supportsVision: true,
    visionModels: [{ id: DEEPSEEK_MODELS.FLASH, label: "DeepSeek Flash (text + vision)" }],
    defaultVisionModel: DEEPSEEK_MODELS.FLASH,
    visionModelManifestKey: "ai_deepseek_vision_model",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    supportedModels: [
      { id: GEMINI_MODELS.FLASH, label: "Gemini 3.6 Flash" },
      { id: GEMINI_MODELS.FLASH_LITE, label: "Gemini 3.5 Flash-Lite" },
      { id: GEMINI_MODELS.PRO, label: "Gemini 3 Pro (paid tier)" },
      { id: GEMINI_MODELS.LEGACY_FLASH_2_0, label: "Gemini 2.0 Flash (legacy)" },
      { id: GEMINI_MODELS.LEGACY_FLASH_1_5, label: "Gemini 1.5 Flash (legacy)" },
    ],
    defaultModel: GEMINI_CONFIG.defaultModel,
    modelManifestKey: "ai_gemini_model",
    apiKeyManifestKey: "ai_gemini_api_key_override",
    supportsVision: true,
    visionModels: [
      { id: GEMINI_MODELS.FLASH, label: "Gemini 3.6 Flash" },
      { id: GEMINI_MODELS.FLASH_LITE, label: "Gemini 3.5 Flash-Lite" },
      { id: GEMINI_MODELS.LEGACY_FLASH_2_0, label: "Gemini 2.0 Flash (legacy)" },
      { id: GEMINI_MODELS.LEGACY_FLASH_1_5, label: "Gemini 1.5 Flash (legacy)" },
    ],
    defaultVisionModel: GEMINI_MODELS.FLASH,
    visionModelManifestKey: "ai_gemini_vision_model",
  },
  groq: {
    id: "groq",
    label: "Groq",
    supportedModels: [
      { id: GROQ_MODELS.GPT_OSS_120B, label: "GPT-OSS 120B" },
      { id: GROQ_MODELS.LLAMA_3_1_8B_INSTANT, label: "Llama 3.1 8B Instant" },
    ],
    defaultModel: GROQ_CONFIG.defaultModel,
    modelManifestKey: "ai_groq_model",
    apiKeyManifestKey: "ai_groq_api_key_override",
    // Groq's hosted open-weight models (GPT-OSS, Llama text variants) used here
    // are text-only — no vision input support, so it is skipped for image
    // classification (see lib/ai/vision.ts DEFAULT_VISION_PROVIDER_ORDER).
    supportsVision: false,
  },
};

/** Default fallback order: DeepSeek → Gemini → Groq. Admin-overridable via `ai_provider_order`. */
export const DEFAULT_PROVIDER_ORDER: AiProviderId[] = ["deepseek", "gemini", "groq"];

/**
 * Default IMAGE classification chain: DeepSeek Flash (vision) primary, Gemini
 * Flash fallback/escalation. Only vision-capable providers are eligible.
 * Admin-overridable via `ai_vision_provider_order` (see lib/ai/vision.ts).
 */
export const DEFAULT_VISION_PROVIDER_ORDER: AiProviderId[] = ["deepseek", "gemini"];

// ---------------------------------------------------------------------------
// Circuit breaker thresholds
// ---------------------------------------------------------------------------

export const CIRCUIT_BREAKER = {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: 3,
  /** Time in milliseconds to keep the circuit open before probing again. */
  recoveryTimeMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Shared chat message type
// ---------------------------------------------------------------------------

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for a chat completion request. */
export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** System prompt to prepend. */
  systemPrompt?: string;
}

/** A normalised completion response returned by any AI provider. */
export interface CompletionResponse {
  /** The generated text content. */
  content: string;
  /** Which provider actually served this response. */
  provider: AiProviderId;
  /** Model identifier that was used. */
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Vision (image classification) types — see lib/ai/vision.ts
// ---------------------------------------------------------------------------

/** Options for a single-image vision completion request. */
export interface VisionCompletionOptions {
  /** Base64-encoded image bytes (no data: URI prefix). */
  imageBase64: string;
  /** e.g. "image/jpeg", "image/png", "image/webp". */
  mimeType: string;
  /** The instruction/prompt describing what to classify and the expected JSON shape. */
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
