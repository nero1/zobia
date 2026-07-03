/**
 * apps/android/src/lib/push/__tests__/index.test.ts
 *
 * ZB-AND-10 baseline test: isAllowedRoute() is the guard that prevents a
 * malicious/crafted push payload's `data.action` from navigating the app to
 * an arbitrary path — this is exactly the kind of narrow, high-blast-radius
 * logic the audit report flagged as untested anywhere in the Android app.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn(async () => ({ remove: () => {} })),
    createChannel: vi.fn(),
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}) },
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn(async () => ({ remove: () => {} })) },
}));
// Transitively imported via lib/api/client.ts (onlineManager wiring) —
// mocked so its web fallback doesn't reach for `window` in a node test env.
vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true })),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  },
}));

import { isAllowedRoute } from "../index";

describe("isAllowedRoute", () => {
  it("allows known dynamic-segment routes with valid ids", () => {
    expect(isAllowedRoute("/rooms/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isAllowedRoute("/messages/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isAllowedRoute("/profile/some_user")).toBe(true);
    expect(isAllowedRoute("/games/tetris-classic")).toBe(true);
  });

  it("allows known static routes", () => {
    for (const route of ["/home", "/wallet", "/notifications", "/friends", "/inbox", "/council"]) {
      expect(isAllowedRoute(route)).toBe(true);
    }
  });

  it("rejects a route not in the allowlist", () => {
    expect(isAllowedRoute("/admin/config")).toBe(false);
    expect(isAllowedRoute("/settings")).toBe(false);
  });

  it("rejects an arbitrary/crafted path from a malicious push payload", () => {
    expect(isAllowedRoute("https://evil.example.com")).toBe(false);
    expect(isAllowedRoute("/../../etc/passwd")).toBe(false);
    expect(isAllowedRoute("javascript:alert(1)")).toBe(false);
  });

  it("rejects a route with an id containing path traversal", () => {
    expect(isAllowedRoute("/rooms/../admin")).toBe(false);
  });
});
