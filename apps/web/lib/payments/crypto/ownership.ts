import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyMessage } from "viem";

export function paymentOwnershipMessage(
  reference: string,
  userId: string,
): string {
  return `Zobia payment ownership\nAccount: ${userId}\nPayment: ${reference}\nSigning proves wallet ownership only. It does not authorize a transfer.`;
}

export async function verifyPaymentOwnership(
  chain: string,
  address: string,
  reference: string,
  userId: string,
  signature: string,
): Promise<boolean> {
  const message = paymentOwnershipMessage(reference, userId);
  try {
    if (chain === "bsc")
      return await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    if (chain !== "solana") return false;
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(new PublicKey(address).toBytes()),
      ]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(message), key, bytes);
  } catch {
    return false;
  }
}
