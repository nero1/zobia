/**
 * lib/monitoring/index.ts
 *
 * Monitoring provider abstraction.
 * Wraps Sentry / New Relic / none based on MONITORING_PROVIDER env var.
 * Import captureException/trackEvent here instead of calling the SDKs directly.
 *
 * BUG-OBS-21: previous implementation only called console.error — actual SDK calls
 * were commented out stubs. This file now invokes the real SDK when available.
 *
 * Both @sentry/nextjs and newrelic are optional peer dependencies; we load them
 * via dynamic require() so a missing package falls back gracefully to console.
 */
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Optional SDK module types (narrow interface, not the full package types)
// ---------------------------------------------------------------------------

interface SentryScopeLike {
  setExtras(extras: Record<string, unknown>): void;
}

interface SentryLike {
  captureException(err: unknown, ctx?: { extra?: Record<string, unknown> }): void;
  captureMessage(msg: string, level?: string): void;
  withScope(callback: (scope: SentryScopeLike) => void): void;
}

interface NewRelicLike {
  noticeError(err: Error | string, attrs?: Record<string, unknown>): void;
  recordCustomEvent(eventType: string, attrs?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Lazy loader helpers — load once and cache; silently fall back if not installed
// ---------------------------------------------------------------------------

let _sentry: SentryLike | null | undefined; // undefined = not yet attempted
let _newrelic: NewRelicLike | null | undefined;

function getSentry(): SentryLike | null {
  if (_sentry !== undefined) return _sentry;
  try {
    // require() is intentional: allows graceful fallback if @sentry/nextjs is not installed
    // eslint-disable-next-line
    _sentry = require("@sentry/nextjs") as SentryLike;
  } catch {
    _sentry = null;
  }
  return _sentry;
}

function getNewRelic(): NewRelicLike | null {
  if (_newrelic !== undefined) return _newrelic;
  try {
    // require() is intentional: allows graceful fallback if newrelic is not installed
    // eslint-disable-next-line
    _newrelic = require("newrelic") as NewRelicLike;
  } catch {
    _newrelic = null;
  }
  return _newrelic;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function captureException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (env.MONITORING_PROVIDER === "sentry" && env.SENTRY_DSN) {
    const sentry = getSentry();
    if (sentry) {
      sentry.captureException(err, { extra: context });
    } else {
      console.error("[monitoring/sentry] SDK not installed — install @sentry/nextjs", err, context);
    }
    return;
  }

  if (env.MONITORING_PROVIDER === "newrelic") {
    const nr = getNewRelic();
    if (nr) {
      const error = err instanceof Error ? err : new Error(String(err));
      nr.noticeError(error, context);
    } else {
      console.error("[monitoring/newrelic] SDK not installed — install newrelic", err, context);
    }
    return;
  }

  console.error("[monitoring]", err, context);
}

export function trackEvent(
  name: string,
  attributes?: Record<string, unknown>
): void {
  if (env.MONITORING_PROVIDER === "sentry" && env.SENTRY_DSN) {
    const sentry = getSentry();
    if (sentry) {
      // BUG-014: pass attributes to Sentry so event context is not dropped
      sentry.withScope((scope) => {
        scope.setExtras(attributes ?? {});
        sentry.captureMessage(name, "info");
      });
      return;
    }
  }

  if (env.MONITORING_PROVIDER === "newrelic") {
    const nr = getNewRelic();
    if (nr) {
      nr.recordCustomEvent(name, attributes);
      return;
    } else {
      console.warn("[monitoring/newrelic] SDK not installed — install newrelic to track events");
    }
  }

  // BUG-047: emit structured log so events are never silently dropped.
  // In development/test: human-readable console.info.
  // In production: structured JSON line so events appear in serverless log aggregators.
  const logLine = JSON.stringify({ event: name, ...attributes });
  if (process.env.NODE_ENV !== "production") {
    console.info("[monitoring/event]", logLine);
  } else {
    // Emit structured log in production so events appear in serverless logs
    console.log(JSON.stringify({ level: "info", type: "monitoring_event", event: name, attributes }));
  }
}
