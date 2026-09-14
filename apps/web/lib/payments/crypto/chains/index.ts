/**
 * lib/payments/crypto/chains/index.ts
 *
 * Chain adapter registry. Extension point: add a new chain by creating
 * `<chain>.ts` implementing `ChainAdapter` and adding one entry here.
 *
 * @module lib/payments/crypto/chains
 */

import type { CryptoChain } from "@zobia/types";
import type { ChainAdapter } from "./types";
import { bscAdapter, BSC_MIN_CONFIRMATIONS } from "./bsc";
import { solanaAdapter, SOLANA_MIN_CONFIRMATIONS } from "./solana";

export const CHAIN_ADAPTERS: Record<CryptoChain, ChainAdapter> = {
  bsc: bscAdapter,
  solana: solanaAdapter,
};

/** Minimum confirmations required per chain before a payment is finalized. */
export const MIN_CONFIRMATIONS: Record<CryptoChain, number> = {
  bsc: BSC_MIN_CONFIRMATIONS,
  solana: SOLANA_MIN_CONFIRMATIONS,
};

export function getChainAdapter(chain: CryptoChain): ChainAdapter {
  const adapter = CHAIN_ADAPTERS[chain];
  if (!adapter) throw new Error(`[crypto] Unsupported chain: ${chain}`);
  return adapter;
}

export type { ChainAdapter, OnChainTransfer, FeeEstimate } from "./types";
