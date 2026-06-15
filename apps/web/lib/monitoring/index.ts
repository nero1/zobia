/**
 * lib/monitoring/index.ts
 *
 * Monitoring provider abstraction.
 * Wraps Sentry / New Relic / none based on MONITORING_PROVIDER env var.
 * Import captureException/trackEvent here instead of calling the SDKs directly.
 */
import { env } from "@/lib/env";

export function captureException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (env.MONITORING_PROVIDER === "sentry" && env.SENTRY_DSN) {
    // When Sentry is installed: Sentry.captureException(err, { extra: context });
    console.error("[monitoring/sentry]", err, context);
  } else if (env.MONITORING_PROVIDER === "newrelic") {
    // When New Relic is installed: newrelic.noticeError(err instanceof Error ? err : new Error(String(err)));
    console.error("[monitoring/newrelic]", err, context);
  } else {
    console.error("[monitoring]", err, context);
  }
}

export function trackEvent(
  name: string,
  attributes?: Record<string, unknown>
): void {
  if (process.env.NODE_ENV !== "production") {
    console.info("[monitoring/event]", name, attributes);
  }
}
