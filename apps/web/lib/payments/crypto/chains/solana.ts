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
  connection = new Connection(rpcUrl, {commitment:"finalized",fetch:((input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)})) as typeof fetch});
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
      commitment: "finalized",
    });
    if (!tx) return notFound;

    const status: OnChainTransfer["status"] = tx.meta?.err ? "failed" : "success";
    const blockTime = tx.blockTime ?? null;

    if (!tx.meta || status !== "success") return {...notFound,status};
    const signers = new Set(tx.transaction.message.accountKeys.filter(k=>k.signer).map(k=>k.pubkey.toBase58()));
    const transfers = tx.transaction.message.instructions.flatMap(instruction => {
      if (!("parsed" in instruction) || instruction.program !== "system" || instruction.parsed?.type !== "transfer") return [];
      const info = instruction.parsed.info;
      if (info.destination !== expectedTo) return [];
      if (!signers.has(info.source) || !Number.isSafeInteger(info.lamports) || info.lamports<=0) throw new Error("Unsupported SOL transfer source or amount");
      return [{source:info.source as string, amount:BigInt(info.lamports)}];
    });
    // A payment has one unambiguous source. CPI transfers and mixed-source
    // transactions require a separate proof contract and are not accepted.
    if (!transfers.length || new Set(transfers.map(t=>t.source)).size !== 1) return notFound;
    const from = transfers[0].source;
    const received = transfers.reduce((sum,t)=>sum+t.amount,0n);

    const confirmations = SOLANA_MIN_CONFIRMATIONS; // getParsedTransaction(finalized) established finality.

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
