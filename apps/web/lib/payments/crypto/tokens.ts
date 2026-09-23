/**
 * lib/payments/crypto/tokens.ts
 *
 * Supported crypto currency registry. Extension point: adding a new
 * currency is (mostly) adding one entry here — plus a price-feed source in
 * priceFeed.ts if it isn't already covered by an existing strategy.
 *
 * @module lib/payments/crypto/tokens
 */

import type { CryptoChain, CryptoCurrency } from "@zobia/types";

export type PriceFeedStrategy =
  | { source: "coingecko"; coingeckoId: string }
  | { source: "dexscreener"; pairAddress?: string; tokenAddress: string };

export interface TokenDefinition {
  symbol: CryptoCurrency;
  chain: CryptoChain;
  /** Contract address, or null for the chain's native currency. */
  contractAddress: string | null;
  decimals: number;
  priceFeed: PriceFeedStrategy;
  /** Human label shown in the UI. */
  label: string;
}

/**
 * JAGA is a BEP-20 token on BNB Smart Chain, listed on PancakeSwap with no
 * CoinGecko listing — its USD price is sourced from DexScreener's public API
 * against its PancakeSwap pool. Decimals default to 18 (the BEP-20 norm);
 * override here if the deployed contract uses a different value.
 */
export const JAGA_CONTRACT_BSC = "0x6a093f2134f66d7625724bc775c3b437ea756588";

export const TOKEN_REGISTRY: Record<CryptoCurrency, TokenDefinition> = {
  JAGA: {
    symbol: "JAGA",
    chain: "bsc",
    contractAddress: JAGA_CONTRACT_BSC,
    decimals: 18,
    priceFeed: { source: "dexscreener", tokenAddress: JAGA_CONTRACT_BSC },
    label: "JAGA",
  },
  BNB: {
    symbol: "BNB",
    chain: "bsc",
    contractAddress: null,
    decimals: 18,
    priceFeed: { source: "coingecko", coingeckoId: "binancecoin" },
    label: "BNB",
  },
  SOL: {
    symbol: "SOL",
    chain: "solana",
    contractAddress: null,
    decimals: 9,
    priceFeed: { source: "coingecko", coingeckoId: "solana" },
    label: "SOL",
  },
};

export function getToken(symbol: CryptoCurrency): TokenDefinition {
  const token = TOKEN_REGISTRY[symbol];
  if (!token) throw new Error(`[crypto] Unsupported currency: ${symbol}`);
  return token;
}

export const SUPPORTED_CURRENCIES: CryptoCurrency[] = Object.keys(TOKEN_REGISTRY) as CryptoCurrency[];

/** Block-explorer URL for a transaction hash, for "view on chain" links in
 *  transaction history (wallet UI). */
export function explorerTxUrl(chain: CryptoChain, txHash: string): string {
  return chain === "bsc"
    ? `https://bscscan.com/tx/${txHash}`
    : `https://solscan.io/tx/${txHash}`;
}

/** Block-explorer URL for a wallet address. */
export function explorerAddressUrl(chain: CryptoChain, address: string): string {
  return chain === "bsc"
    ? `https://bscscan.com/address/${address}`
    : `https://solscan.io/account/${address}`;
}
