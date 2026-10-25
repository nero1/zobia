import type { LoggerOptions } from "pino";
interface SafeError {
  type: string;
  code?: string;
  frames?: string[];
  cause?: SafeError;
}
/** Exception messages/configuration can contain SQL parameters, credentials
 * and private content. Keep classification and bounded source locations only. */
export function safeLogError(
  error: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): SafeError {
  try {
    if (!(error instanceof Error)) return { type: "NonError" };
    const type = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.constructor.name)
      ? error.constructor.name
      : "Error";
    const result: SafeError = { type };
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code))
      result.code = code;
    if (
      typeof error.message === "string" &&
      error.message.length <= 16000 &&
      typeof error.name === "string" &&
      error.name.length <= 128
    ) {
      const prefix = `${error.name}: ${error.message}`,
        stack = error.stack;
      if (
        typeof stack === "string" &&
        stack.length <= 32000 &&
        stack.startsWith(prefix + "\n")
      ) {
        const frames = stack
          .slice(prefix.length + 1)
          .split("\n")
          .slice(0, 12)
          .flatMap((line) => {
            const location =
              /\(?((?:file:\/\/|https?:\/\/|\/|node:)[^()\s]+):(\d+):(\d+)\)?$/.exec(
                line,
              );
            if (!location) return [];
            const file = location[1]
              .split(/[?#]/)[0]
              .split("/")
              .at(-1)!
              .replace(/[^A-Za-z0-9_.:-]/g, "_")
              .slice(-100);
            return [`${file}:${location[2]}:${location[3]}`];
          });
        if (frames.length) result.frames = frames.slice(0, 8);
      }
    }
    if (depth < 2 && !seen.has(error)) {
      seen.add(error);
      const cause = (error as Error & { cause?: unknown }).cause;
      if (cause && !seen.has(cause))
        result.cause = safeLogError(cause, depth + 1, seen);
    }
    return result;
  } catch {
    return { type: "Error" };
  }
}
const sensitive = new Set([
  "authorization",
  "cookie",
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "email",
  "body",
  "payload",
  "params",
  "query",
  "config",
  "text",
  "content",
  "message",
  "description",
  "reason",
  "rejectionreason",
  "stack",
  "detail",
  "details",
  "sql",
  "statement",
  "parameters",
  "headers",
  "address",
  "walletaddress",
  "accountnumber",
  "bankaccount",
  "pin",
  "pinhash",
  "totpsecret",
  "recoverycodes",
  "backupcodes",
  "otp",
  "phonenumber",
  "phone",
  "dateofbirth",
  "dob",
]);
/** Sanitize nested structured records too: Error instances can appear under
 * arbitrary keys and HTTP errors contain enumerable request configuration. */
export function safeLogRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const seen = new WeakSet<object>(),
    budget = { left: 500 };
  const visit = (value: unknown, depth: number): unknown => {
    if (--budget.left < 0 || depth > 5) return "[Truncated]";
    if (value instanceof Error) return safeLogError(value);
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return value;
    if (typeof value === "string")
      return value.length <= 1000
        ? value
        : value.slice(0, 1000) + "[Truncated]";
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date)
      return Number.isFinite(value.getTime())
        ? value.toISOString()
        : "InvalidDate";
    if (!value || typeof value !== "object") return undefined;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value))
      return value.slice(0, 50).map((item) => visit(item, depth + 1));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 80)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, "");
      if (sensitive.has(normalized)) {
        result[key] = "[REDACTED]";
        continue;
      }
      try {
        const item = (value as Record<string, unknown>)[key];
        result[key] = ["err", "error", "cause"].includes(key)
          ? safeLogError(item)
          : visit(item, depth + 1);
      } catch {
        result[key] = "[Unserializable]";
      }
    }
    return result;
  };
  return visit(record, 0) as Record<string, unknown>;
}
export const privacyLogOptions: Pick<LoggerOptions, "formatters"> = {
  formatters: { log: safeLogRecord },
};
/** Monitoring SDKs receive a fresh error without custom properties or raw causes. */
export function monitoringError(error: unknown): Error {
  const safe = safeLogError(error),
    result = new Error(safe.code ? `${safe.type} (${safe.code})` : safe.type);
  result.name = safe.type;
  result.stack =
    `${result.name}: ${result.message}` +
    (safe.frames?.length
      ? "\n" + safe.frames.map((frame) => "    at " + frame).join("\n")
      : "");
  return result;
}
export function safeMonitoringContext(
  context?: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const allowed = new Set([
    "requestId",
    "userId",
    "route",
    "method",
    "provider",
    "source",
    "status",
    "statusCode",
    "durationMs",
    "resourceId",
    "operation",
    "attempts",
  ]);
  return Object.fromEntries(
    Object.entries(context ?? {}).filter(
      ([key, value]) =>
        allowed.has(key) &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "boolean" ||
          (typeof value === "string" &&
            value.length <= 256 &&
            !/[?@\r\n]/.test(value))),
    ),
  ) as Record<string, string | number | boolean>;
}
