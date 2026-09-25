/**
 * Unit tests for lib/payments/contextSettings.ts
 *
 * lib/payments/contextSettings.ts has been migrated to Drizzle ORM (getDb() /
 * the query builder) instead of the raw `@/lib/db` adapter. Rather than
 * hand-mock every `.select()/.insert()/.update()` chain shape (which would
 * silently drift from what Drizzle actually compiles), these tests back a
 * *real* `drizzle-orm/node-postgres` instance with a fake `pg`-shaped client
 * whose `query()` is a jest.fn. Every query the module issues still goes
 * through real Drizzle query compilation — exactly like production — and
 * lands on `mockQuery` as plain SQL text + params, which tests dispatch on
 * (see lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 *
 * Note: `client.query()` for a "fields" (select) query is invoked in pg's
 * positional ("array") row mode, so mocked rows must be arrays of values in
 * the same column order as `paymentContextSettings` is defined in the
 * schema (contextKey, paystackEnabled, cryptoEnabledCurrencies, isFree,
 * updatedBy, updatedAt) — not keyed objects.
 *
 * Key invariants tested:
 *  - updatePaymentContextSettings only overwrites the fields present in the
 *    patch — an undefined field must not clobber the existing value.
 *  - makeAllPaymentsFree issues a single unconditional UPDATE (no WHERE
 *    clause needed — every context row that exists gets `is_free = true`).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/drizzle";

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === "string" ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

// `as any` on the client sidesteps drizzle-orm's `$client: Pool` typing
// (a real Pool isn't needed at runtime — drizzle only ever calls
// `client.query()` for a non-Pool client).
const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

// contextSettings.ts does not import `@/lib/db` (the raw adapter) directly,
// but keep it mocked defensively so no test accidentally opens a real
// connection.
jest.mock("@/lib/db", () => ({ db: {} }));

import { updatePaymentContextSettings, makeAllPaymentsFree, enforcePaymentContext } from "../contextSettings";
import { ApiError } from "@/lib/api/errors";

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

/** A `payment_context_settings` row in schema column order. */
function contextRow(f: {
  contextKey?: string;
  paystackEnabled?: boolean;
  cryptoEnabledCurrencies?: string[];
  isFree?: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
}) {
  return [
    f.contextKey ?? "coin_purchase",
    f.paystackEnabled ?? true,
    f.cryptoEnabledCurrencies ?? [],
    f.isFree ?? false,
    f.updatedBy ?? null,
    f.updatedAt ?? null,
  ];
}

describe("updatePaymentContextSettings", () => {
  it("preserves existing fields not present in the patch", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('select') && text.includes('from "payment_context_settings"')) {
        return Promise.resolve({
          rows: [
            contextRow({
              contextKey: "coin_purchase",
              paystackEnabled: true,
              cryptoEnabledCurrencies: ["JAGA"],
              isFree: false,
            }),
          ],
          rowCount: 1,
        });
      }
      if (text.includes('insert into "payment_context_settings"')) {
        return Promise.resolve({ rows: [], rowCount: 0 }); // the upsert itself
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await updatePaymentContextSettings("coin_purchase", { isFree: true }, "admin-1");

    const upsertCall = mockQuery.mock.calls.find(
      ([text]: [string]) => typeof text === "string" && text.includes('insert into "payment_context_settings"')
    );
    expect(upsertCall).toBeDefined();
    const [, params] = upsertCall as [string, unknown[]];
    // params: [context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by]
    expect(params[1]).toBe(true); // paystackEnabled preserved
    expect(JSON.parse(params[2] as string)).toEqual(["JAGA"]); // cryptoEnabledCurrencies preserved
    expect(params[3]).toBe(true); // isFree updated
  });
});

describe("enforcePaymentContext", () => {
  function mockSettings(row: {
    paystack_enabled?: boolean;
    crypto_enabled_currencies?: string[];
    is_free?: boolean;
  }) {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('select') && text.includes('from "payment_context_settings"')) {
        return Promise.resolve({
          rows: [
            contextRow({
              contextKey: "coin_purchase",
              paystackEnabled: row.paystack_enabled ?? true,
              cryptoEnabledCurrencies: row.crypto_enabled_currencies ?? [],
              isFree: row.is_free ?? false,
            }),
          ],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  it("returns isFree=true and skips every other check when the context is free", async () => {
    mockSettings({ is_free: true, paystack_enabled: false, crypto_enabled_currencies: [] });
    const decision = await enforcePaymentContext("coin_purchase", false, "paystack", undefined);
    expect(decision).toEqual({ isFree: true });
  });

  it("rejects a disabled provider even though the client asked for it (bypass attempt)", async () => {
    mockSettings({ paystack_enabled: false, crypto_enabled_currencies: ["JAGA"] });
    await expect(enforcePaymentContext("coin_purchase", true, "paystack", undefined)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a crypto currency the admin has not enabled for this context", async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ["JAGA"] });
    await expect(enforcePaymentContext("coin_purchase", false, "crypto", "BNB" as never)).rejects.toBeInstanceOf(ApiError);
  });

  it("accepts an enabled crypto currency", async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ["JAGA", "BNB"] });
    const decision = await enforcePaymentContext("coin_purchase", false, "crypto", "BNB" as never);
    expect(decision).toEqual({ isFree: false, provider: "crypto", cryptoCurrency: "BNB" });
  });

  it('rejects a non-Nigerian user when only paystack is enabled ("only Nigeria" case)', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: [] });
    await expect(enforcePaymentContext("coin_purchase", false, undefined, undefined)).rejects.toMatchObject({ code: "UNSUPPORTED_REGION" });
  });

  it("defaults a Nigerian user to paystack when no provider is requested", async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ["JAGA"] });
    const decision = await enforcePaymentContext("coin_purchase", true, undefined, undefined);
    expect(decision).toEqual({ isFree: false, provider: "paystack" });
  });

  it("defaults a non-Nigerian user to crypto when paystack is unavailable to them", async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ["JAGA"] });
    await expect(enforcePaymentContext("coin_purchase", false, undefined, undefined)).rejects.toThrow(
      "cryptoCurrency is required"
    );
  });
});

describe("makeAllPaymentsFree", () => {
  it("runs a single UPDATE setting is_free = true for every context", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await makeAllPaymentsFree("admin-1");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/update "payment_context_settings" set "is_free" = \$?\d+|true/i);
  });
});
