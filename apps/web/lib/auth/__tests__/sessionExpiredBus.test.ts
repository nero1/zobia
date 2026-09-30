/**
 * The "session expired" notice must only fire for someone who WAS signed in,
 * and only once. Regression tests for the popup that kept reappearing (even
 * in new windows, days later) because every anonymous visitor's 401 from
 * GET /api/auth/me was treated as an expired session.
 */

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function setupWindow(initial: Record<string, string> = {}) {
  const storage = new MemoryStorage();
  Object.entries(initial).forEach(([k, v]) => storage.setItem(k, v));
  const listeners: Array<() => void> = [];
  const win = {
    localStorage: storage,
    location: { origin: "https://zobia.test" },
    dispatchEvent: jest.fn(() => { listeners.forEach((l) => l()); return true; }),
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    removeEventListener: jest.fn(),
    fetch: jest.fn(async () => ({ ok: true, status: 200 })),
  };
  (global as unknown as { window: unknown }).window = win;
  (global as unknown as { CustomEvent: unknown }).CustomEvent = class { constructor(public type: string) {} };
  return { storage, win };
}

async function load() {
  jest.resetModules();
  return import("@/lib/auth/sessionExpiredBus");
}

afterEach(() => {
  delete (global as unknown as { window?: unknown }).window;
});

describe("markSessionExpired", () => {
  it("ignores a 401 for a visitor who never had a session", async () => {
    const { win } = setupWindow();
    const bus = await load();
    bus.markSessionExpired();
    expect(bus.isSessionExpired()).toBe(false);
    expect(win.dispatchEvent).not.toHaveBeenCalled();
  });

  it("announces expiry for a returning signed-in user, once, and clears the device hint", async () => {
    const { storage, win } = setupWindow({ "zobia:auth:had-session": "1" });
    const bus = await load();
    bus.markSessionExpired();
    bus.markSessionExpired();
    expect(bus.isSessionExpired()).toBe(true);
    expect(win.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(storage.getItem("zobia:auth:had-session")).toBeNull();
  });

  it("does not re-announce in a new window once the expiry was announced", async () => {
    const first = setupWindow({ "zobia:auth:had-session": "1" });
    const bus1 = await load();
    bus1.markSessionExpired();
    // A new window shares the device's localStorage but starts with fresh module state.
    const second = setupWindow();
    second.storage.setItem("zobia:auth:had-session", first.storage.getItem("zobia:auth:had-session") ?? "");
    const bus2 = await load();
    bus2.markSessionExpired();
    expect(bus2.isSessionExpired()).toBe(false);
  });

  it("arms after markSessionActive (e.g. /api/auth/me succeeded)", async () => {
    setupWindow();
    const bus = await load();
    bus.markSessionActive();
    bus.markSessionExpired();
    expect(bus.isSessionExpired()).toBe(true);
  });

  it("clearSessionHint (explicit logout) disarms it", async () => {
    setupWindow({ "zobia:auth:had-session": "1" });
    const bus = await load();
    bus.clearSessionHint();
    bus.markSessionExpired();
    expect(bus.isSessionExpired()).toBe(false);
  });
});
