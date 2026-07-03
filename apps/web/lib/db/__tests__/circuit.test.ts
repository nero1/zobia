/**
 * Unit tests for the DB circuit breaker wiring (BUG-CAP-02).
 *
 * `withCircuitBreaker` previously had no test coverage at all (it also had no
 * callers, which was the bug). These tests cover the one piece of logic this
 * module owns: converting the shared `RedisCircuitBreaker`'s own OPEN/timeout
 * rejections into a 503-shaped plain Error, while leaving errors thrown by the
 * wrapped function (real Postgres errors) completely untouched.
 */

const mockExecute = jest.fn();

jest.mock("@/lib/payments/circuit", () => ({
  RedisCircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: (fn: () => Promise<unknown>) => mockExecute(fn),
  })),
}));

import { withCircuitBreaker } from "@/lib/db/circuit";

describe("withCircuitBreaker", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  test("returns the wrapped function's result on success", async () => {
    mockExecute.mockImplementation((fn: () => Promise<unknown>) => fn());

    const result = await withCircuitBreaker(async () => ({ rows: [{ ok: 1 }] }));

    expect(result).toEqual({ rows: [{ ok: 1 }] });
  });

  test("converts a circuit-OPEN rejection into a 503 plain error", async () => {
    mockExecute.mockRejectedValue(new Error("[database] Circuit is OPEN — request rejected"));

    await expect(withCircuitBreaker(async () => "unreachable")).rejects.toMatchObject({
      statusCode: 503,
      code: "DB_UNAVAILABLE",
    });
  });

  test("converts a breaker call-timeout rejection into a 503 plain error", async () => {
    mockExecute.mockRejectedValue(new Error("[database] Call timed out after 10000ms"));

    await expect(withCircuitBreaker(async () => "unreachable")).rejects.toMatchObject({
      statusCode: 503,
      code: "DB_UNAVAILABLE",
    });
  });

  test("re-throws errors from the wrapped function completely unchanged", async () => {
    mockExecute.mockImplementation((fn: () => Promise<unknown>) => fn());

    const pgError = new Error("duplicate key value violates unique constraint") as Error & {
      code: string;
    };
    pgError.code = "23505";

    await expect(
      withCircuitBreaker(async () => {
        throw pgError;
      })
    ).rejects.toBe(pgError);
  });
});
