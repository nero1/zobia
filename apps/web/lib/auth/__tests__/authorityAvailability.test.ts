const mockLimit = jest.fn();
jest.mock("@/lib/auth/jwt", () => ({
  ...jest.requireActual("@/lib/auth/jwt"),
  verifyAccessToken: async () => ({
    sub: "11111111-1111-4111-8111-111111111111",
    sid: "22222222-2222-4222-8222-222222222222",
    type: "access",
  }),
}));
jest.mock("@/lib/auth/session", () => ({
  getSessionFresh: async () => ({
    uid: "11111111-1111-4111-8111-111111111111",
    sid: "22222222-2222-4222-8222-222222222222",
    created_at: new Date().toISOString(),
  }),
  ACCESS_TOKEN_COOKIE: "zobia_at",
  REFRESH_TOKEN_COOKIE: "zobia_rt",
}));
jest.mock("@/lib/db/drizzle", () => ({
  schema: jest.requireActual("@/lib/db/schema").schema,
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
  }),
}));
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
it("fails closed with 503 and keeps credentials when account authority cannot be read", async () => {
  mockLimit.mockRejectedValueOnce(new Error("temporary database outage"));
  const handler = jest.fn(async () => NextResponse.json({ success: true }));
  const result = await withAuth(handler)(
    new NextRequest("http://localhost:3000/api/private", {
      headers: { Authorization: "Bearer fixture" },
    }),
    { params: Promise.resolve({}) },
  );
  expect(result.status).toBe(503);
  expect((await result.json()).error.code).toBe("AUTHORITY_UNAVAILABLE");
  expect(result.headers.get("set-cookie")).toBeNull();
  expect(handler).not.toHaveBeenCalled();
});
it("still rejects an actually missing account as unauthorized", async () => {
  mockLimit.mockResolvedValueOnce([]);
  const result = await withAuth(async () =>
    NextResponse.json({ success: true }),
  )(
    new NextRequest("http://localhost:3000/api/private", {
      headers: { Authorization: "Bearer fixture" },
    }),
    { params: Promise.resolve({}) },
  );
  expect(result.status).toBe(401);
});
