import { storedCryptoQuote } from "../storedQuote";
describe("resuming an initialized crypto quote", () => {
  const base = { tokenSymbol: "BNB", chain: "bsc", walletAddress: "test-address", expectedTokenAmount: "100000000000000000000" };
  it("retains integer trailing zeroes when stripping only fractional padding", () => { expect(storedCryptoQuote(base)?.expectedDisplayAmount).toBe("100"); });
  it("preserves a single base unit exactly without a price feed call", () => { expect(storedCryptoQuote({ ...base, expectedTokenAmount: "1" })?.expectedDisplayAmount).toBe("0.000000000000000001"); });
  it("uses the correct decimals for Solana", () => { expect(storedCryptoQuote({ ...base, tokenSymbol: "SOL", chain: "solana", expectedTokenAmount: "1234567890" })?.expectedDisplayAmount).toBe("1.23456789"); });
  it.each([{ ...base, chain: "solana" }, { ...base, expectedTokenAmount: "0" }, { ...base, expectedTokenAmount: "-1" }, { ...base, tokenSymbol: "UNKNOWN" }])("rejects an invalid or mismatched quote snapshot", value => { expect(storedCryptoQuote(value)).toBeNull(); });
});
