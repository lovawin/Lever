"use client";

import { ReactNode, useState, useEffect } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, arbitrum } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

// Hyperliquid uses Arbitrum-style signing under the hood, but trades
// settle on Hyperliquid L1. We still need an EVM wallet connected.
const wagmiConfig = getDefaultConfig({
  appName: "Lever",
  projectId: "lever-mvp-placeholder", // get real one at cloud.reown.com when going live
  chains: [mainnet, arbitrum],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Avoid SSR hydration mismatch — wagmi is client-only
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{mounted ? children : null}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
