/**
 * lib/payments/crypto/chains/bsc.ts
 *
 * BNB Smart Chain adapter (native BNB + BEP-20 tokens, e.g. JAGA).
 * Extension point: to support another EVM chain (e.g. Ethereum, Polygon),
 * copy this file, change RPC/chain id, and register it in chains/index.ts —
 * everything else (ERC-20 ABI, viem usage) is chain-agnostic.
 *
 * @module lib/payments/crypto/chains/bsc
 */

import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { bsc } from "viem/chains";
import type { ChainAdapter, OnChainTransfer, FeeEstimate } from "./types";

const DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org";

/** Minimum confirmations before we treat a BSC transfer as final. BSC blocks
 *  are ~3s; 15 blocks is a conservative ~45s finality window. */
export const BSC_MIN_CONFIRMATIONS = 15;

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

let client: PublicClient | null = null;
function getClient(): PublicClient {
  if (client) return client;
  const rpcUrl = process.env.BSC_RPC_URL || DEFAULT_BSC_RPC;
  client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  return client;
}

export const bscAdapter: ChainAdapter = {
  chain: "bsc",

  isValidAddress(address: string): boolean {
    return isAddress(address);
  },

  async getNativeBalance(address: string): Promise<bigint> {
    return getClient().getBalance({ address: getAddress(address) });
  },

  async getTokenBalance(address: string, tokenContract: string, _decimals: number): Promise<bigint> {
    const balance = await getClient().readContract({
      address: getAddress(tokenContract),
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [getAddress(address)],
    });
    return balance as bigint;
  },

  async getTransfer(
    txHash: string,
    expectedTo: string,
    tokenContract: string | null
  ): Promise<OnChainTransfer> {
    const c = getClient();
    const notFound: OnChainTransfer = {
      hash: txHash,
      from: "",
      to: "",
      valueBaseUnits: 0n,
      tokenContract,
      confirmations: 0,
      status: "not_found",
      blockTime: null,
    };

    let receipt;
    try {
      receipt = await c.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch {
      return notFound;
    }
    if (!receipt) return notFound;

    const [latestBlock, block] = await Promise.all([
      c.getBlockNumber(),
      c.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null),
    ]);
    const confirmations = Number(latestBlock - receipt.blockNumber) + 1;
    const status: OnChainTransfer["status"] = receipt.status === "success" ? "success" : "failed";
    const blockTime = block ? Number(block.timestamp) : null;

    if (tokenContract) {
      // BEP-20 transfer: find the Transfer log emitted by the token contract.
      const target = getAddress(tokenContract);
      const wantTo = getAddress(expectedTo);
      const log = receipt.logs.find((l) => {
        if (getAddress(l.address) !== target) return false;
        // topics[0] is the event signature hash; topics[2] is the indexed `to`.
        if (!l.topics[2]) return false;
        const toAddr = `0x${l.topics[2].slice(-40)}`;
        return getAddress(toAddr) === wantTo;
      });
      if (!log) {
        return { ...notFound, status: receipt.status === "success" ? "not_found" : "failed" };
      }
      const value = BigInt(log.data);
      const fromTopic = log.topics[1];
      const from = fromTopic ? getAddress(`0x${fromTopic.slice(-40)}`) : "";
      return {
        hash: txHash,
        from,
        to: expectedTo,
        valueBaseUnits: value,
        tokenContract,
        confirmations,
        status,
        blockTime,
      };
    }

    // Native BNB transfer: read the tx itself for value/to.
    const tx = await c.getTransaction({ hash: txHash as `0x${string}` });
    return {
      hash: txHash,
      from: tx.from,
      to: tx.to ?? "",
      valueBaseUnits: tx.value,
      tokenContract: null,
      confirmations,
      status,
      blockTime,
    };
  },

  async estimateTransferFee(tokenContract: string | null): Promise<FeeEstimate> {
    try {
      const c = getClient();
      const gasPrice = await c.getGasPrice();
      // A simple BNB transfer is 21000 gas; a BEP-20 transfer is heavier —
      // 65000 is a reasonable conservative estimate for a standard ERC-20.
      const gasLimit = tokenContract ? 65_000n : 21_000n;
      return { feeBaseUnits: gasPrice * gasLimit, isEstimate: false };
    } catch {
      // Fallback: ~0.001 BNB, clearly labeled as an estimate to the caller.
      return { feeBaseUnits: 1_000_000_000_000_000n, isEstimate: true };
    }
  },
};

// Re-exported for tests / the ERC-20 Transfer topic hash if ever needed.
export const ERC20_TRANSFER_EVENT_SIGNATURE = ERC20_TRANSFER_EVENT;
