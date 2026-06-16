/**
 * lib/api/errors.ts
 *
 * Typed API error classes and standardised error response helpers.
 *
 * All route handlers should use these helpers to ensure consistent error
 * shapes across every endpoint. The `handleApiError` function is the single
 * egress point for converting thrown errors into NextResponse objects.
 *
 * Error response shape:
 * ```json
 * { "error": { "code": "NOT_FOUND", "message": "Resource not found" } }
 * ```
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

/**
 * Structured API error that carries an HTTP status code, a machine-readable
 * code string, and a human-readable message.
 *
 * Throw this from route handlers – `handleApiError` will serialize it.
 */
export class ApiError extends Error {
  /**
   * @param status  - HTTP status code to respond with
   * @param code    - Machine-readable error code (e.g. "NOT_FOUND")
   * @param message - Human-readable description
   * @param details - Optional additional detail (not sent to client in production)
   * @param headers - Optional response headers to include (e.g. Retry-After)
   */
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * 400 Bad Request – invalid input or malformed request.
 * @param message       - Human-readable description
 * @param codeOrDetails - Optional string error code OR object with validation details
 */
export function badRequest(
  message = "Bad request",
  codeOrDetails: string | unknown = "BAD_REQUEST"
): ApiError {
  const code = typeof codeOrDetails === "string" ? codeOrDetails : "BAD_REQUEST";
  const details = typeof codeOrDetails !== "string" ? codeOrDetails : undefined;
  return new ApiError(400, code, message, details);
}

/**
 * 401 Unauthorized – missing or invalid authentication credentials.
 * @param message - Human-readable description
 */
export function unauthorized(message = "Unauthorized"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

/**
 * 403 Forbidden – authenticated but not permitted to perform the action.
 * @param message - Human-readable description
 */
export function forbidden(message = "Forbidden", code = "FORBIDDEN"): ApiError {
  return new ApiError(403, code, message);
}

/**
 * 404 Not Found – resource does not exist.
 * @param message - Human-readable description
 */
export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

/**
 * 409 Conflict – state conflict (e.g. duplicate username).
 * @param message - Human-readable description
 * @param code    - Optional machine-readable code (default "CONFLICT")
 */
export function conflict(message = "Conflict", code = "CONFLICT"): ApiError {
  return new ApiError(409, code, message);
}

/**
 * 429 Too Many Requests – rate limit exceeded.
 * @param message - Human-readable description
 */
export function tooManyRequests(message = "Too many requests"): ApiError {
  return new ApiError(429, "RATE_LIMITED", message);
}

/**
 * 500 Internal Server Error.
 * @param message - Human-readable description
 */
export function internalError(message = "Internal server error"): ApiError {
  return new ApiError(500, "INTERNAL_ERROR", message);
}

// ---------------------------------------------------------------------------
// Response shape types
// ---------------------------------------------------------------------------

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    /** Validation issues – only present for 400 Zod errors */
    issues?: Array<{ path: string; message: string }>;
  };
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

/**
 * Convert any thrown value into a well-formed NextResponse with a consistent
 * JSON body shape.
 *
 * - `ApiError`   → uses its own status + code + message
 * - `ZodError`   → 400 with flattened field-level issues
 * - Everything else → 500 (details logged server-side only)
 *
 * @param error - The caught error value
 * @returns NextResponse with appropriate status and JSON body
 */
export function handleApiError(error: unknown): NextResponse<ErrorResponseBody> {
  // Known API error
  if (error instanceof ApiError) {
    const body: ErrorResponseBody = {
      error: { code: error.code, message: error.message },
    };
    const res = NextResponse.json(body, { status: error.status });
    if (error.headers) {
      for (const [key, value] of Object.entries(error.headers)) {
        res.headers.set(key, value);
      }
    }
    return res;
  }

  // Zod validation error
  if (error instanceof ZodError) {
    const issues = error.errors.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Validation failed", issues } },
      { status: 400 }
    );
  }

  // Insufficient balance errors — map to 402 Payment Required
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "INSUFFICIENT_BALANCE" || code === "INSUFFICIENT_STAR_BALANCE") {
      return NextResponse.json(
        { error: { code, message: error.message } },
        { status: 402 }
      );
    }
  }

  // Plain errors with an explicit statusCode (e.g. FEATURE_DISABLED from requireFeatureEnabled)
  if (error instanceof Error && "statusCode" in error) {
    const e = error as Error & { code?: string; statusCode: number };
    console.error("[api] Unhandled error:", error);
    return NextResponse.json(
      { error: { code: e.code ?? "ERROR", message: e.message } },
      { status: e.statusCode }
    );
  }

  // Unknown – log and return generic 500
  console.error("[api] Unhandled error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 }
  );
}

/**
 * Wrap a handler function with automatic error handling.
 * Catches any thrown error and delegates to `handleApiError`.
 *
 * @param fn - Async route handler function
 * @returns Handler that never throws
 */
export function withErrorHandling<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<NextResponse<TReturn>>
): (...args: TArgs) => Promise<NextResponse<TReturn | ErrorResponseBody>> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return handleApiError(err) as NextResponse<TReturn | ErrorResponseBody>;
    }
  };
}
