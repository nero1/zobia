import { sponsoredFundingQuote, fundingMicros } from "../sponsoredFunding";
import { createIdempotentSubmission } from "@zobia/shared/utils";
it("preserves exact microcredit precision and rounds only the initial whole-credit reserve up", () => {
  expect(fundingMicros("0.000001")).toBe(1n);
  expect(sponsoredFundingQuote(5, 2, "10.000001")).toEqual({
    marketing: 11n,
    application: 10n,
    total: 21n,
  });
  for (const value of ["0.0000001", "-1", "Infinity", "1000000001"])
    expect(() => fundingMicros(value)).toThrow();
  for (const [reward, slots] of [
    [0, 1],
    [100001, 1],
    [1, 1001],
    [1, 0],
  ])
    expect(() => sponsoredFundingQuote(reward, slots, 0)).toThrow();
});
it("keeps the operation and relative dates fixed on retry, while changed form inputs start a new operation", () => {
  const form = createIdempotentSubmission(true);
  const input = {
    rewardCoins: 5,
    startsAt: "2026-10-25T00:00:00Z",
    endsAt: "2026-10-26T00:00:00Z",
  };
  const first = form.prepare(input),
    retry = form.prepare({
      ...input,
      startsAt: "2026-10-25T01:00:00Z",
      endsAt: "2026-10-26T01:00:00Z",
    });
  expect(retry).toEqual(first);
  expect(form.prepare({ ...input, rewardCoins: 6 }).idempotencyKey).not.toBe(
    first.idempotencyKey,
  );
  form.clear();
  expect(form.prepare(input).idempotencyKey).not.toBe(first.idempotencyKey);
});
it("treats explicitly chosen dates as part of an administrator submission", () => {
  const form = createIdempotentSubmission();
  const first = form.prepare({ startsAt: "2026-10-25" });
  expect(form.prepare({ startsAt: "2026-10-26" }).idempotencyKey).not.toBe(
    first.idempotencyKey,
  );
});
