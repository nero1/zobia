/**
 * lib/ai/client.ts
 *
 * AI client with circuit breaker pattern.
 *
 * Request flow:
 *   1. Try DeepSeek (primary).
 *   2. If DeepSeek fails or circuit is open → fall back to Gemini.
 *   3. Circuit opens after CIRCUIT_BREAKER.failureThreshold consecutive failures.
 *   4. Circuit resets after CIRCUIT_BREAKER.recoveryTimeMs.
 *
 * @example
 * ```ts
 * import { aiClient } from '@/lib/ai/client';
 * const res = await aiClient.chat([{ role: 'user', content: 'Hello!' }]);
 * ```
 */

import axios from "axios";
import { env } from "@/lib/env";
import { getManifestValue } from "@/lib/manifest";
import {
  DEEPSEEK_CONFIG,
  GEMINI_CONFIG,
  CIRCUIT_BREAKER,
  type ChatMessage,
  type CompletionOptions,
  type CompletionResponse,
} from "./config";

// ---------------------------------------------------------------------------
// Circuit breaker state
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const deepseekCircuit: CircuitState = { failures: 0, openedAt: null };

/** Read-only snapshot of the DeepSeek circuit breaker state for admin inspection. */
export function getDeepSeekCircuitState(): Readonly<CircuitState> {
  return { ...deepseekCircuit };
}

function isCircuitOpen(state: CircuitState): boolean {
  if (state.openedAt === null) return false;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed >= CIRCUIT_BREAKER.recoveryTimeMs) {
    // Half-open: allow one probe
    state.openedAt = null;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordFailure(state: CircuitState): void {
  state.failures += 1;
  if (state.failures >= CIRCUIT_BREAKER.failureThreshold) {
    state.openedAt = Date.now();
    console.warn(
      `[ai:circuit-breaker] DeepSeek circuit OPEN after ${state.failures} failures`
    );
  }
}

function recordSuccess(state: CircuitState): void {
  state.failures = 0;
  state.openedAt = null;
}

// ---------------------------------------------------------------------------
// DeepSeek adapter
// ---------------------------------------------------------------------------

interface DeepSeekResponse {
  id: string;
  choices: Array<{
    message: { content: string; role: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

async function callDeepSeek(
  messages: ChatMessage[],
  options: CompletionOptions,
  apiKeyOverride?: string
): Promise<CompletionResponse> {
  const model = options.model ?? DEEPSEEK_CONFIG.defaultModel;
  const endpoint = `${env.DEEPSEEK_API_ENDPOINT}/chat/completions`;

  const manifestOverride = await getManifestValue("ai_deepseek_api_key_override");
  const effectiveKey =
    apiKeyOverride ??
    (manifestOverride && manifestOverride.length > 0 ? manifestOverride : env.DEEPSEEK_API_KEY);

  const body = {
    model,
    messages: options.systemPrompt
      ? [{ role: "system", content: options.systemPrompt }, ...messages]
      : messages,
    max_tokens: options.maxTokens ?? DEEPSEEK_CONFIG.maxTokens,
    temperature: options.temperature ?? DEEPSEEK_CONFIG.temperature,
  };

  const { data } = await axios.post<DeepSeekResponse>(endpoint, body, {
    headers: {
      Authorization: `Bearer ${effectiveKey}`,
      "Content-Type": "application/json",
    },
    timeout: DEEPSEEK_CONFIG.timeoutMs,
  });

  return {
    content: data.choices[0]?.message?.content ?? "",
    provider: "deepseek",
    model: data.model,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini adapter
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/** Convert OpenAI-style messages to Gemini's `contents` format. */
function toGeminiContents(
  messages: ChatMessage[],
  systemPrompt?: string
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  if (systemPrompt) {
    // Gemini handles system prompt as first user turn (model spec)
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }

  for (const msg of messages) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  return contents;
}

async function callGemini(
  messages: ChatMessage[],
  options: CompletionOptions,
  apiKeyOverride?: string
): Promise<CompletionResponse> {
  const model = options.model ?? GEMINI_CONFIG.defaultModel;

  const manifestOverride = await getManifestValue("ai_gemini_api_key_override");
  const effectiveKey =
    apiKeyOverride ??
    (manifestOverride && manifestOverride.length > 0 ? manifestOverride : env.GEMINI_API_KEY);

  const endpoint =
    `${GEMINI_CONFIG.apiBaseUrl}/models/${model}:generateContent` +
    `?key=${effectiveKey}`;

  const body = {
    contents: toGeminiContents(messages, options.systemPrompt),
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? GEMINI_CONFIG.maxTokens,
      temperature: options.temperature ?? GEMINI_CONFIG.temperature,
    },
  };

  const { data } = await axios.post<GeminiResponse>(endpoint, body, {
    headers: { "Content-Type": "application/json" },
    timeout: GEMINI_CONFIG.timeoutMs,
  });

  const text =
    data.candidates[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

  return {
    content: text,
    provider: "gemini",
    model,
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request.
 * Tries DeepSeek first; falls back to Gemini if DeepSeek is down.
 *
 * @param messages - Conversation history
 * @param options  - Optional model / generation overrides
 * @returns Normalised completion response
 */
async function chat(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<CompletionResponse> {
  // Primary: DeepSeek
  if (!isCircuitOpen(deepseekCircuit)) {
    try {
      const response = await callDeepSeek(messages, options);
      recordSuccess(deepseekCircuit);
      return response;
    } catch (err) {
      recordFailure(deepseekCircuit);
      console.error("[ai:deepseek] request failed, falling back to Gemini", err);
    }
  } else {
    console.warn("[ai:circuit-breaker] DeepSeek circuit is OPEN, using Gemini");
  }

  // Fallback: Gemini
  return callGemini(messages, options);
}

/**
 * Send a single-turn prompt (convenience wrapper around `chat`).
 *
 * @param prompt  - User's text prompt
 * @param options - Optional model / generation overrides
 * @returns Generated text string
 */
async function complete(
  prompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  const response = await chat([{ role: "user", content: prompt }], options);
  return response.content;
}

/**
 * AI client singleton.
 * Use `aiClient.chat(...)` or `aiClient.complete(...)` anywhere in the app.
 */
export const aiClient = {
  chat,
  complete,
} as const;

// ---------------------------------------------------------------------------
// Admin test helpers — bypass circuit breaker, used by /api/admin/ai-settings/test
// ---------------------------------------------------------------------------

/**
 * Send a minimal ping to DeepSeek to verify the key and reachability.
 * Bypasses the circuit breaker — intended for admin connection testing only.
 */
export async function testDeepSeekConnection(apiKey?: string): Promise<CompletionResponse> {
  return callDeepSeek(
    [{ role: "user", content: "ping" }],
    { maxTokens: 1, temperature: 0 },
    apiKey
  );
}

/**
 * Send a minimal ping to Gemini to verify the key and reachability.
 * Intended for admin connection testing only.
 */
export async function testGeminiConnection(apiKey?: string): Promise<CompletionResponse> {
  return callGemini(
    [{ role: "user", content: "ping" }],
    { maxTokens: 1, temperature: 0 },
    apiKey
  );
}
