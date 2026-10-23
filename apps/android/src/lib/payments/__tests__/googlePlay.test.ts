import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ approved: null as null | ((transaction: unknown) => Promise<void>), post: vi.fn(), get: vi.fn(), register: vi.fn(), order: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: mocks.get, post: mocks.post } }));
vi.mock("capacitor-plugin-cdv-purchase", () => ({
  ProductType: { CONSUMABLE: "consumable", PAID_SUBSCRIPTION: "subscription" }, Platform: { GOOGLE_PLAY: "google_play" }, ErrorCode: { PURCHASE: 1 },
  store: { register: mocks.register, initialize: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined), error: vi.fn(), when: () => ({ approved: (fn: (transaction: unknown) => Promise<void>) => { mocks.approved = fn; } }), get: (id: string) => ({ getOffer: () => ({ id }) }), order: mocks.order },
}));
import { initGooglePlayBilling, purchaseBusinessTier, purchaseSubscription, refreshAccountStoreProducts } from "../googlePlay";
describe("verified Google Play purchase completion", () => {
  beforeAll(async () => { mocks.get.mockResolvedValue({ data: [{ id: "custom.business", kind: "business", basePlan: "growth", accountTypeSlug: "custom", interval: "monthly" }, { id: "custom.personal", kind: "personal", basePlan: "plus", accountTypeSlug: "custom_plus", interval: "monthly" }] }); await initGooglePlayBilling(); });
  afterEach(() => { vi.useRealTimers(); });
  it("registers custom and historical account SKUs with the correct store group", () => {
    expect(mocks.register.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "custom.business", group: "business_tier" }), expect.objectContaining({ id: "custom.personal", group: "plan_tier" })]));
  });
  it("registers newly configured SKUs without requiring an app restart", async () => {
    mocks.get.mockResolvedValue({ data: [{ id: "new.personal", kind: "personal", basePlan: "pro", accountTypeSlug: "new_pro", interval: "monthly" }] });
    await refreshAccountStoreProducts(["new.personal"]);
    expect(mocks.register.mock.calls[mocks.register.mock.calls.length - 1]?.[0]).toEqual([expect.objectContaining({ id: "new.personal", group: "plan_tier" })]);
  });
  it("finishes a business transaction when the API client has unwrapped its success envelope", async () => {
    vi.useFakeTimers(); mocks.post.mockResolvedValue({ data: { tier: "growth" } });
    const calls = mocks.order.mock.calls.length;
    const pending = purchaseBusinessTier("custom.business", "Example shop");
    await vi.waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(calls + 1));
    const finish = vi.fn().mockResolvedValue(undefined);
    await mocks.approved!({ products: [{ id: "custom.business" }], parentReceipt: { purchaseToken: "test-token" }, finish });
    expect(await pending).toEqual({ success: true, tier: "growth" }); expect(finish).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps an unverified purchase unfinished so Google can replay it", async () => {
    vi.useFakeTimers(); mocks.post.mockResolvedValue({ data: { success: false } });
    const calls = mocks.order.mock.calls.length;
    const pending = purchaseSubscription("custom.personal"); const finish = vi.fn();
    await vi.waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(calls + 1));
    await mocks.approved!({ products: [{ id: "custom.personal" }], parentReceipt: { purchaseToken: "pending-token" }, finish });
    expect((await pending).success).toBe(false); expect(finish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
