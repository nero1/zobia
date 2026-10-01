/**
 * @jest-environment node
 */
import {
  IDENTITY_TTL_MS,
  cachedIdentityFetch,
  identityCacheKey,
  invalidateIdentityCache,
} from "@/lib/auth/identityCache";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  invalidateIdentityCache();
  jest.useRealTimers();
});

describe("identityCacheKey", () => {
  const u = (p: string) => new URL(p, "https://zobia.test");

  it("caches exact GETs of the identity endpoints only", () => {
    expect(identityCacheKey(u("/api/users/me"), "GET")).toBe("/api/users/me");
    expect(identityCacheKey(u("/api/auth/me"), undefined)).toBe("/api/auth/me");
    expect(identityCacheKey(u("/api/users/me"), "PUT")).toBeNull();
    expect(identityCacheKey(u("/api/users/me?fields=x"), "GET")).toBeNull();
    expect(identityCacheKey(u("/api/users/me/avatar"), "GET")).toBeNull();
    expect(identityCacheKey(u("/api/feed"), "GET")).toBeNull();
  });
});

describe("cachedIdentityFetch", () => {
  it("shares one in-flight request between concurrent callers", async () => {
    const doFetch = jest.fn(async () => jsonResponse({ user: { id: "u1" } }));
    const [a, b] = await Promise.all([
      cachedIdentityFetch("/api/users/me", doFetch),
      cachedIdentityFetch("/api/users/me", doFetch),
    ]);
    expect(doFetch).toHaveBeenCalledTimes(1);
    // Each caller gets its own readable Response.
    expect(await a.json()).toEqual({ user: { id: "u1" } });
    expect(await b.json()).toEqual({ user: { id: "u1" } });
  });

  it("reuses a successful response until the TTL expires", async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const doFetch = jest.fn(async () => jsonResponse({ user: { id: "u1" } }));
    await cachedIdentityFetch("/api/users/me", doFetch);
    await cachedIdentityFetch("/api/users/me", doFetch);
    expect(doFetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000_000 + IDENTITY_TTL_MS + 1);
    await cachedIdentityFetch("/api/users/me", doFetch);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("never caches error responses", async () => {
    const doFetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorised" }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: "u1" } }));
    const first = await cachedIdentityFetch("/api/auth/me", doFetch);
    expect(first.status).toBe(401);
    const second = await cachedIdentityFetch("/api/auth/me", doFetch);
    expect(second.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("refetches after invalidation", async () => {
    const doFetch = jest.fn(async () => jsonResponse({ user: { id: "u1" } }));
    await cachedIdentityFetch("/api/users/me", doFetch);
    invalidateIdentityCache();
    await cachedIdentityFetch("/api/users/me", doFetch);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("does not store a response that was in flight when the cache was invalidated", async () => {
    let release!: (r: Response) => void;
    const slow = jest.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = cachedIdentityFetch("/api/users/me", slow);
    invalidateIdentityCache(); // e.g. the user saved their profile meanwhile
    release(jsonResponse({ user: { coins: 10 } }));
    expect(await (await pending).json()).toEqual({ user: { coins: 10 } });

    const fresh = jest.fn(async () => jsonResponse({ user: { coins: 5 } }));
    const next = await cachedIdentityFetch("/api/users/me", fresh);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(await next.json()).toEqual({ user: { coins: 5 } });
  });

  it("keeps the two endpoints separate", async () => {
    const users = jest.fn(async () => jsonResponse({ user: { id: "a" } }));
    const auth = jest.fn(async () => jsonResponse({ user: { id: "b" } }));
    expect(await (await cachedIdentityFetch("/api/users/me", users)).json()).toEqual({ user: { id: "a" } });
    expect(await (await cachedIdentityFetch("/api/auth/me", auth)).json()).toEqual({ user: { id: "b" } });
  });
});
