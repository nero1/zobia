/**
 * apps/android/src/lib/api/__tests__/client.test.ts
 *
 * ZB-AND-10 baseline test: refreshAccessToken()'s single-flight lock is the
 * highest blast-radius, least-visually-obvious logic in this app — a
 * regression here (e.g. two concurrent 401s each kicking off their own
 * refresh) would silently double-consume the one-time-use refresh token
 * rotation and log users out under load, with no visual symptom until it
 * happens in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "zobia_rt" ? { value: "stored-refresh-token" } : { value: null }
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn(async () => ({ remove: () => {} })) },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true })),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  },
}));

// `refreshAccessToken` calls the module-level `axios.post` (not the
// `apiClient` instance) directly against the refresh endpoint — mock only
// that call, not axios.create, so the rest of the client module still wires
// up normally.
vi.spyOn(axios, "post").mockResolvedValue({
  status: 200,
  data: { accessToken: "new-access-token", expiresIn: 900 },
});

// The background /users/me sync inside refreshAccessToken fires-and-forgets
// a real `fetch` — stub it so tests don't attempt a real network call.
vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in test")));

import { refreshAccessToken } from "../client";

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockClear();
  });

  it("single-flights concurrent callers into one network request", async () => {
    const [a, b, c] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(a).toBe("new-access-token");
    expect(b).toBe("new-access-token");
    expect(c).toBe("new-access-token");
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("issues a fresh network request on a later, separate call", async () => {
    await refreshAccessToken();
    expect(axios.post).toHaveBeenCalledTimes(1);

    await refreshAccessToken();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
