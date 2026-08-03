"use client";

import { useAccount as useWagmiAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";

export default function WalletBar() {
  const { address: evmAddress, isConnected: evmConnected } = useWagmiAccount();
  const { publicKey, connected: solConnected, disconnect: solDisconnect } = useWallet();
  const solAddress = publicKey?.toBase58() ?? null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* EVM (Hyperliquid signing) */}
      <div className="[&_button]:!h-9 [&_button]:!text-sm">
        <ConnectButton
          accountStatus="address"
          chainStatus="icon"
          showBalance={false}
          label={evmConnected ? "EVM ✓" : "Connect EVM"}
        />
      </div>

      {/* Solana (Phantom/Solflare) — informational for now */}
      {mounted && (
        <div className="[&_button]:!h-9 [&_button]:!text-sm">
          <WalletMultiButton
            style={{
              backgroundColor: solConnected ? "#9945FF" : "#141414",
              border: solConnected ? "none" : "1px solid #1f2937",
              color: solConnected ? "#fff" : "#f5f5f5",
              fontSize: "0.875rem",
              padding: "0 12px",
              borderRadius: "0.375rem",
              height: "2.25rem",
            }}
          >
            {solConnected
              ? `SOL ${solAddress?.slice(0, 4)}…${solAddress?.slice(-4)}`
              : "Connect Solana"}
          </WalletMultiButton>
        </div>
      )}
    </div>
  );
}
