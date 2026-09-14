/**
 * lib/payments/crypto/wagmiConfig.ts
 *
 * Client-side wagmi configuration for the BNB Smart Chain (JAGA / BNB)
 * checkout flow — MetaMask (injected) and WalletConnect v2. Solana (SOL)
 * uses @solana/wallet-adapter-react instead (see SolanaWalletProviders.tsx)
 * — wagmi/viem only cover EVM chains.
 *
 * Isolated from the rest of the app (not mounted at the root layout) — it's
 * only instantiated inside CryptoCheckoutModal, which is itself lazily
 * imported, so pages that never open the crypto checkout never pay for
 * wagmi/viem/WalletConnect in their bundle.
 *
 * @module lib/payments/crypto/wagmiConfig
 */

import { createConfig, http, injected } from "wagmi";
import { bsc } from "wagmi/chains";
import { walletConnect } from "wagmi/connectors";
import type { CreateConnectorFn } from "wagmi";

let cachedConfig: ReturnType<typeof createConfig> | null = null;

/** WalletConnect v2 requires a project ID from https://cloud.walletconnect.com — see .env.example. */
export function hasWalletConnectProjectId(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
}

export function getWagmiConfig() {
  if (cachedConfig) return cachedConfig;

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const connectors: CreateConnectorFn[] = [injected()];
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
        metadata: {
          name: "Zobia Social",
          description: "Pay with crypto on Zobia Social",
          url: typeof window !== "undefined" ? window.location.origin : "https://zobia.app",
          icons: [],
        },
      })
    );
  }

  cachedConfig = createConfig({
    chains: [bsc],
    connectors,
    transports: {
      [bsc.id]: http(),
    },
  });
  return cachedConfig;
}
