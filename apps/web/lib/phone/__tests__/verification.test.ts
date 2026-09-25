/**
 * Unit tests for lib/phone/verification.ts.
 *
 * Backs a real drizzle-orm/node-postgres instance with a fake pg-shaped
 * client (see lib/seasons/__tests__/seasonEngine.test.ts for the same
 * pattern) so real Drizzle query compilation runs exactly like production;
 * mockQuery receives plain SQL text + params to dispatch on.
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

const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

const mockLoadManifest = jest.fn();
jest.mock("@/lib/manifest", () => ({
  loadManifest: () => mockLoadManifest(),
}));

const mockSendSms = jest.fn();
jest.mock("@/lib/notifications/sms", () => ({
  sendSms: (...args: unknown[]) => mockSendSms(...args),
}));

import { startPhoneVerification, confirmPhoneVerification } from "@/lib/phone/verification";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function manifestWith(phoneVerificationRequired: boolean) {
  return { phoneVerificationRequired };
}

/** Array-mode row matching phoneVerificationCodes' column definition order. */
function pendingCodeRow(overrides: {
  phoneNumber?: string;
  attempts?: number;
  expiresAt?: Date;
}) {
  return [
    USER_ID,
    overrides.phoneNumber ?? "+2348012345678",
    "irrelevant-hash",
    overrides.attempts ?? 0,
    overrides.expiresAt ?? new Date(Date.now() + 5 * 60_000),
    new Date(),
  ];
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockLoadManifest.mockReset();
  mockSendSms.mockReset();
  mockSendSms.mockResolvedValue({ ok: true });
});

describe("startPhoneVerification", () => {
  it("throws on an invalid phone number", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(false));
    await expect(startPhoneVerification(USER_ID, "abc")).rejects.toMatchObject({
      code: "INVALID_PHONE_NUMBER",
    });
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("saves the number immediately and sends no SMS when verification is off", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(false));

    const result = await startPhoneVerification(USER_ID, "08012345678");

    expect(result).toEqual({ requiresVerification: false });
    expect(mockSendSms).not.toHaveBeenCalled();
    const updateCall = mockQuery.mock.calls.find(([text]) => /update "users"/i.test(text));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain("+2348012345678");
  });

  it("sends an SMS and stores a pending code when verification is on", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(true));

    const result = await startPhoneVerification(USER_ID, "+2348012345678");

    expect(result.requiresVerification).toBe(true);
    expect(result.expiresInSeconds).toBe(600);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][0]).toBe("+2348012345678");
    const insertCall = mockQuery.mock.calls.find(([text]) => /insert into "phone_verification_codes"/i.test(text));
    expect(insertCall).toBeDefined();
  });

  it("rolls back the pending code and throws when the SMS send fails", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(true));
    mockSendSms.mockResolvedValue({ ok: false, error: "not_configured" });

    await expect(startPhoneVerification(USER_ID, "+2348012345678")).rejects.toMatchObject({
      code: "SMS_SEND_FAILED",
    });

    const deleteCall = mockQuery.mock.calls.find(([text]) => /delete from "phone_verification_codes"/i.test(text));
    expect(deleteCall).toBeDefined();
  });
});

describe("confirmPhoneVerification", () => {
  it("throws NOT_FOUND when there is no pending code", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (/select .* from "phone_verification_codes"/i.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await expect(confirmPhoneVerification(USER_ID, "123456")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("throws CODE_EXPIRED and clears the row when the code has expired", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (/select .* from "phone_verification_codes"/i.test(text)) {
        return { rows: [pendingCodeRow({ expiresAt: new Date(Date.now() - 1000) })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(confirmPhoneVerification(USER_ID, "123456")).rejects.toMatchObject({
      code: "CODE_EXPIRED",
    });
    const deleteCall = mockQuery.mock.calls.find(([text]) => /delete from "phone_verification_codes"/i.test(text));
    expect(deleteCall).toBeDefined();
  });

  it("rejects with RATE_LIMITED once the attempt cap is hit", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (/select .* from "phone_verification_codes"/i.test(text)) {
        return { rows: [pendingCodeRow({ attempts: 5 })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(confirmPhoneVerification(USER_ID, "123456")).rejects.toMatchObject({
      status: 429,
    });
  });

  it("increments attempts and throws INVALID_CODE on a hash mismatch", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (/select .* from "phone_verification_codes"/i.test(text)) {
        return { rows: [pendingCodeRow({})], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(confirmPhoneVerification(USER_ID, "000000")).rejects.toMatchObject({
      code: "INVALID_CODE",
    });
    const updateCall = mockQuery.mock.calls.find(([text]) => /update "phone_verification_codes"/i.test(text));
    expect(updateCall).toBeDefined();
  });
});
