/**
 * lib/payments/crypto/chains/solana.ts
 *
 * Solana adapter (native SOL only — no SPL tokens supported yet; add SPL
 * token-account lookups here if a Solana-based token is registered later).
 *
 * @module lib/payments/crypto/chains/solana
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { ChainAdapter, OnChainTransfer, FeeEstimate } from "./types";

const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/** Solana finality is fast and deterministic — "finalized" commitment is
 *  effectively irreversible, so 1 confirmation at that commitment is enough. */
export const SOLANA_MIN_CONFIRMATIONS = 1;

let connection: Connection | null = null;
function getConnection(): Connection {
  if (connection) return connection;
  const rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC;
  connection = new Connection(rpcUrl, "confirmed");
  return connection;
}

export const solanaAdapter: ChainAdapter = {
  chain: "solana",

  isValidAddress(address: string): boolean {
    try {
      // Solana addresses are base58-encoded 32-byte public keys.
      // eslint-disable-next-line no-new
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  },

  async getNativeBalance(address: string): Promise<bigint> {
    const lamports = await getConnection().getBalance(new PublicKey(address));
    return BigInt(lamports);
  },

  async getTokenBalance(_address: string, _tokenContract: string, _decimals: number): Promise<bigint> {
    throw new Error("[crypto/solana] SPL token balances are not supported yet — SOL is native-only");
  },

  async getTransfer(
    txHash: string,
    expectedTo: string,
    tokenContract: string | null
  ): Promise<OnChainTransfer> {
    if (tokenContract) {
      throw new Error("[crypto/solana] SPL token transfers are not supported yet");
    }
    const notFound: OnChainTransfer = {
      hash: txHash,
      from: "",
      to: "",
      valueBaseUnits: 0n,
      tokenContract: null,
      confirmations: 0,
      status: "not_found",
      blockTime: null,
    };

    const conn = getConnection();
    const tx = await conn.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return notFound;

    const status: OnChainTransfer["status"] = tx.meta?.err ? "failed" : "success";
    const blockTime = tx.blockTime ?? null;

    // Find a native SOL transfer instruction targeting `expectedTo`.
    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const toIndex = accountKeys.indexOf(expectedTo);
    if (toIndex === -1 || !tx.meta) return { ...notFound, status: status === "success" ? "not_found" : status };

    const preBalance = tx.meta.preBalances[toIndex] ?? 0;
    const postBalance = tx.meta.postBalances[toIndex] ?? 0;
    const received = BigInt(Math.max(0, postBalance - preBalance));
    if (received === 0n) return { ...notFound, status: status === "success" ? "not_found" : status };

    // Best-effort sender: the fee payer (index 0) is the transaction's signer.
    const from = accountKeys[0] ?? "";

    const slot = tx.slot;
    let confirmations = SOLANA_MIN_CONFIRMATIONS;
    try {
      const currentSlot = await conn.getSlot("confirmed");
      confirmations = Math.max(1, currentSlot - slot);
    } catch {
      // keep default
    }

    return {
      hash: txHash,
      from,
      to: expectedTo,
      valueBaseUnits: received,
      tokenContract: null,
      confirmations,
      status,
      blockTime,
    };
  },

  async estimateTransferFee(_tokenContract: string | null): Promise<FeeEstimate> {
    // Solana's fee is fixed per signature (5000 lamports for a standard
    // single-signature transfer) — not worth an RPC round trip.
    return { feeBaseUnits: 5_000n, isEstimate: false };
  },
};

export { LAMPORTS_PER_SOL };
