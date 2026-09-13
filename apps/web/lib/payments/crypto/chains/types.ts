/**
 * lib/payments/crypto/chains/types.ts
 *
 * Common interface every chain adapter implements. This is the extension
 * point for adding a new chain later: create `chains/<chain>.ts`
 * implementing `ChainAdapter` and register it in `chains/index.ts`.
 *
 * Kept free of any cross-imports into the rest of the app (no db, no
 * manifest, no logger) so this subtree stays portable to other projects —
 * only the chain RPC client libraries (viem / @solana/web3.js) are used.
 *
 * @module lib/payments/crypto/chains/types
 */

import type { CryptoChain } from "@zobia/types";

/** A native or token transfer found on-chain for a given transaction hash. */
export interface OnChainTransfer {
  hash: string;
  /** Sending address. */
  from: string;
  /** Receiving address actually credited. */
  to: string;
  /** Transferred amount in the token's smallest unit (wei / lamports / etc). */
  valueBaseUnits: bigint;
  /** Token contract address, or null for a native-currency transfer. */
  tokenContract: string | null;
  /** Confirmations since inclusion (0 = not yet confirmed / not found). */
  confirmations: number;
  /** On-chain execution status. "pending" = seen in mempool/not yet mined. */
  status: "success" | "failed" | "pending" | "not_found";
  /** Unix seconds block timestamp, if mined. */
  blockTime: number | null;
}

export interface FeeEstimate {
  feeBaseUnits: bigint;
  /** True when this is a rough estimate (e.g. RPC estimation failed and a
   *  hardcoded fallback was used) rather than a live quote. */
  isEstimate: boolean;
}

export interface ChainAdapter {
  readonly chain: CryptoChain;

  /** Validate an address's format for this chain (no network call). */
  isValidAddress(address: string): boolean;

  /** Native-currency balance, in the chain's smallest unit. */
  getNativeBalance(address: string): Promise<bigint>;

  /** ERC-20 / SPL token balance, in the token's smallest unit. */
  getTokenBalance(address: string, tokenContract: string, decimals: number): Promise<bigint>;

  /**
   * Look up a transaction by hash and, if it represents a transfer of the
   * given token (or native currency when `tokenContract` is null) to
   * `expectedTo`, return its details. Returns a transfer with
   * status "not_found" when the tx doesn't exist (yet) at the queried RPC.
   */
  getTransfer(
    txHash: string,
    expectedTo: string,
    tokenContract: string | null
  ): Promise<OnChainTransfer>;

  /** Rough fee estimate for a simple transfer, in native smallest units. */
  estimateTransferFee(tokenContract: string | null): Promise<FeeEstimate>;
}
