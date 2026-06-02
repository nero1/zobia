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
  /** Which provider actually served this response ("deepseek" | "gemini"). */
  provider: "deepseek" | "gemini";
  /** Model identifier that was used. */
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
