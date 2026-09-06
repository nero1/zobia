/**
 * Unit tests for the Support Ticket System charging model
 * (lib/support/service.ts#shouldChargeMessage) — a pure function, no mocks
 * required.
 */

import { shouldChargeMessage } from "@/lib/support/service";

describe("shouldChargeMessage", () => {
  describe("first_message_only", () => {
    it("charges only message 1", () => {
      expect(shouldChargeMessage("first_message_only", 1, 1)).toBe(true);
      expect(shouldChargeMessage("first_message_only", 1, 2)).toBe(false);
      expect(shouldChargeMessage("first_message_only", 1, 10)).toBe(false);
    });
  });

  describe("every_message", () => {
    it("charges every message regardless of index", () => {
      for (let i = 1; i <= 20; i++) {
        expect(shouldChargeMessage("every_message", 1, i)).toBe(true);
      }
    });
  });

  describe("every_x_messages", () => {
    it("charges only multiples of X", () => {
      expect(shouldChargeMessage("every_x_messages", 3, 1)).toBe(false);
      expect(shouldChargeMessage("every_x_messages", 3, 2)).toBe(false);
      expect(shouldChargeMessage("every_x_messages", 3, 3)).toBe(true);
      expect(shouldChargeMessage("every_x_messages", 3, 6)).toBe(true);
      expect(shouldChargeMessage("every_x_messages", 3, 7)).toBe(false);
    });

    it("treats X=1 as charge-every-message", () => {
      for (let i = 1; i <= 5; i++) {
        expect(shouldChargeMessage("every_x_messages", 1, i)).toBe(true);
      }
    });

    it("clamps a misconfigured 0 or negative X to 1 (never divides by zero, never silently charges nothing)", () => {
      expect(shouldChargeMessage("every_x_messages", 0, 1)).toBe(true);
      expect(shouldChargeMessage("every_x_messages", -5, 3)).toBe(true);
    });
  });

  describe("first_x_messages", () => {
    it("charges only messages 1..X", () => {
      expect(shouldChargeMessage("first_x_messages", 3, 1)).toBe(true);
      expect(shouldChargeMessage("first_x_messages", 3, 2)).toBe(true);
      expect(shouldChargeMessage("first_x_messages", 3, 3)).toBe(true);
      expect(shouldChargeMessage("first_x_messages", 3, 4)).toBe(false);
    });
  });

  it("falls back to charging message 1 only for an unknown model value", () => {
    // @ts-expect-error deliberately passing an invalid model to test the fail-safe default
    expect(shouldChargeMessage("bogus_model", 3, 1)).toBe(true);
    // @ts-expect-error deliberately passing an invalid model to test the fail-safe default
    expect(shouldChargeMessage("bogus_model", 3, 2)).toBe(false);
  });
});
