/**
 * lib/logger.ts
 *
 * SYS-03: Structured, per-request logger built on pino.
 *
 * Usage:
 *   import { logger, createRequestLogger } from "@/lib/logger";
 *
 *   // Module-level (no request context)
 *   logger.error({ userId }, "Something went wrong");
 *
 *   // Per-request (includes requestId + route)
 *   const reqLog = createRequestLogger(requestId, userId, "/api/economy/gifts/send");
 *   reqLog.info({ giftId }, "Gift sent");
 */

import pino, { type Logger } from "pino";

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  // JSON in production, pretty-print in development
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } }
      : undefined,
  base: { env: process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

// ---------------------------------------------------------------------------
// Per-request child logger factory
// ---------------------------------------------------------------------------

/**
 * Create a child logger pre-bound with request tracing fields.
 * Call this once per request inside the route handler or middleware.
 *
 * @param requestId - UUID generated per request (from withAuth HOC)
 * @param userId    - Authenticated user's UUID (or "anonymous")
 * @param route     - API route path (e.g. "/api/economy/gifts/send")
 */
export function createRequestLogger(
  requestId: string,
  userId: string | null,
  route: string
): Logger {
  return logger.child({ requestId, userId: userId ?? "anonymous", route });
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage for request context (optional per-module use)
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  requestId: string;
  userId: string | null;
  route: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Returns a logger bound to the current AsyncLocalStorage request context,
 * or the root logger if no context is active.
 */
export function getContextLogger(): Logger {
  const ctx = requestContext.getStore();
  if (!ctx) return logger;
  return logger.child({ requestId: ctx.requestId, userId: ctx.userId ?? "anonymous", route: ctx.route });
}

/**
 * Alias for getContextLogger() — returns a child logger with the requestId
 * from the current AsyncLocalStorage context, or root logger if absent.
 */
export function getRequestLogger(): Logger {
  const ctx = requestContext.getStore();
  return logger.child({ requestId: ctx?.requestId });
}
