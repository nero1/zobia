const mockRefresh = jest.fn();
jest.mock("@/lib/auth/refreshSession", () => ({
  refreshSession: () => mockRefresh(),
}));
function setup() {
  const data: Record<string, unknown> = { "zobia:auth:had-session": "1" };
  Object.defineProperties(data, {
    getItem: { value: (key: string) => data[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        data[key] = value;
      },
    },
    removeItem: {
      value: (key: string) => {
        delete data[key];
      },
    },
  });
  const win = {
    location: { origin: "https://zobia.test" },
    localStorage: data,
    dispatchEvent: jest.fn(),
    fetch: jest.fn(),
  };
  (global as unknown as { window: unknown }).window = win;
  (global as unknown as { CustomEvent: unknown }).CustomEvent = class {};
  return win;
}
afterEach(() => {
  delete (global as unknown as { window?: unknown }).window;
  jest.resetModules();
  mockRefresh.mockReset();
});
it("renews an ordinary protected fetch before declaring expiry and replays a Request body safely", async () => {
  const win = setup(),
    bodies: string[] = [];
  win.fetch.mockImplementation(async (input: Request) => {
    bodies.push(await input.text());
    return new Response("{}", { status: bodies.length === 1 ? 401 : 200 });
  });
  mockRefresh.mockResolvedValue(true);
  const bus = await import("../sessionExpiredBus");
  bus.installSessionExpiryFetchGuard();
  const response = await window.fetch(
    new Request("https://zobia.test/api/private", {
      method: "POST",
      body: "same-operation",
    }),
  );
  expect(response.status).toBe(200);
  expect(bodies).toEqual(["same-operation", "same-operation"]);
  expect(win.dispatchEvent).not.toHaveBeenCalled();
  expect(bus.isSessionExpired()).toBe(false);
});
it("keeps the session when a raw fetch cannot renew during a temporary outage", async () => {
  const win = setup();
  win.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
  mockRefresh.mockRejectedValue(new Error("temporary authority failure"));
  const bus = await import("../sessionExpiredBus");
  bus.installSessionExpiryFetchGuard();
  await expect(window.fetch("https://zobia.test/api/private")).rejects.toThrow(
    "temporary authority failure",
  );
  expect(win.dispatchEvent).not.toHaveBeenCalled();
  expect(bus.isSessionExpired()).toBe(false);
});

it("preserves owner-scoped offline messages across ordinary reads, while logout still purges them", async () => {
  const win = setup();
  win.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  const cache = await import("@/lib/chat/messageCache");
  cache.writeCachedMessages("dm:fixture", [{ id: "cached-message" }], "owner");
  const bus = await import("../sessionExpiredBus");
  bus.installSessionExpiryFetchGuard();
  await window.fetch("https://zobia.test/api/widgets");
  expect(cache.readCachedMessages("dm:fixture", "owner")).toEqual([
    { id: "cached-message" },
  ]);
  bus.clearSessionHint();
  expect(cache.readCachedMessages("dm:fixture", "owner")).toBeNull();
});

it("does not replay a protected write after logout changes the session", async () => {
  const win = setup();
  const baseFetch = win.fetch;
  win.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
  const bus = await import("../sessionExpiredBus");
  mockRefresh.mockImplementation(async () => {
    bus.clearSessionHint();
    bus.markSessionActive();
    return true;
  });
  bus.installSessionExpiryFetchGuard();
  const response = await window.fetch("https://zobia.test/api/private", {
    method: "POST",
    body: "old-account-write",
  });
  expect(response.status).toBe(401);
  expect(baseFetch).toHaveBeenCalledTimes(1);
  expect(bus.isSessionExpired()).toBe(false);
});
