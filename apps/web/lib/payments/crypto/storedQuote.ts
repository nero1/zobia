import Decimal from "decimal.js";
import { getToken } from "./tokens";
import type { CryptoCurrency } from "@zobia/types";
/** Resume the original quoted base units; a market-price refresh must never
 * silently change the amount of an already initialized payment. */
export function storedCryptoQuote(row: { tokenSymbol: string | null; chain: string | null; walletAddress: string | null; expectedTokenAmount: string | null }) {
  if (!["JAGA","BNB","SOL"].includes(row.tokenSymbol ?? "") || !row.walletAddress || !row.expectedTokenAmount || !/^\d+$/.test(row.expectedTokenAmount)) return null;
  const token = getToken(row.tokenSymbol as CryptoCurrency);
  if (row.chain !== token.chain || new Decimal(row.expectedTokenAmount).lte(0)) return null;
  return { currency: token.symbol, chain: token.chain, receivingAddress: row.walletAddress, expectedBaseUnits: row.expectedTokenAmount, expectedDisplayAmount: new Decimal(row.expectedTokenAmount).div(new Decimal(10).pow(token.decimals)).toFixed(token.decimals).replace(/\.?0+$/, ""), tokenContract: token.contractAddress };
}
