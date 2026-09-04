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
  /** General-purpose chat / reasoning. */
  CHAT: "deepseek-chat",
  /** Code generation and analysis. */
  CODER: "deepseek-coder",
  /** Reasoning model (chain-of-thought). */
  REASONER: "deepseek-reasoner",
} as const;

export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];

export const DEEPSEEK_CONFIG = {
  /** Default model for most tasks. */
  defaultModel: DEEPSEEK_MODELS.CHAT,
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
  /** Latest stable Gemini 1.5 Flash (fast, cost-effective). */
  FLASH: "gemini-1.5-flash",
  /** Gemini 1.5 Pro (higher capacity). */
  PRO: "gemini-1.5-pro",
  /** Gemini 2.0 Flash (cutting-edge fast model). */
  FLASH_2: "gemini-2.0-flash-exp",
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

export const GEMINI_CONFIG = {
  /** Default fallback model. Prefer Flash for cost and speed. */
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
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    supportedModels: [
      { id: DEEPSEEK_MODELS.CHAT, label: "DeepSeek Chat" },
      { id: DEEPSEEK_MODELS.REASONER, label: "DeepSeek Reasoner" },
    ],
    defaultModel: DEEPSEEK_CONFIG.defaultModel,
    modelManifestKey: "ai_deepseek_model",
    apiKeyManifestKey: "ai_deepseek_api_key_override",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    supportedModels: [
      { id: GEMINI_MODELS.FLASH, label: "Gemini 1.5 Flash" },
      { id: GEMINI_MODELS.PRO, label: "Gemini 1.5 Pro" },
      { id: GEMINI_MODELS.FLASH_2, label: "Gemini 2.0 Flash" },
    ],
    defaultModel: GEMINI_CONFIG.defaultModel,
    modelManifestKey: "ai_gemini_model",
    apiKeyManifestKey: "ai_gemini_api_key_override",
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
  },
};

/** Default fallback order: DeepSeek → Gemini → Groq. Admin-overridable via `ai_provider_order`. */
export const DEFAULT_PROVIDER_ORDER: AiProviderId[] = ["deepseek", "gemini", "groq"];

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
