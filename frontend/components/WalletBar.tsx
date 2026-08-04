"use client";

import { useAccount as useWagmiAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";

export default function WalletBar() {
  const { isConnected: evmConnected } = useWagmiAccount();
  const { publicKey, connected: solConnected } = useWallet();
  const solAddress = publicKey?.toBase58() ?? null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center gap-2">
      <div className="[&_button]:!h-9 [&_button]:!text-xs [&_button]:!rounded-lg [&_button]:!font-semibold [&_button]:!border-white/10">
        <ConnectButton
          accountStatus="address"
          chainStatus="icon"
          showBalance={false}
          label={evmConnected ? "EVM ✓" : "Connect EVM"}
        />
      </div>
      {mounted && (
        <div className="[&_button]:!h-9 [&_button]:!text-xs [&_button]:!rounded-lg">
          <WalletMultiButton
            style={{
              backgroundColor: solConnected ? "#9945FF" : "rgba(255,255,255,0.05)",
              border: solConnected ? "none" : "1px solid rgba(255,255,255,0.1)",
              color: "#f5f5f5",
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0 14px",
              borderRadius: "0.5rem",
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