"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function WalletBar() {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="h-9 w-28 rounded-lg bg-white/10 animate-pulse" />
    );
  }

  return (
    <div className="[&_button]:!h-9 [&_button]:!text-xs [&_button]:!rounded-lg [&_button]:!font-semibold [&_button]:!border-white/10">
      <ConnectButton
        accountStatus="address"
        chainStatus="icon"
        showBalance={false}
        label={isConnected ? "EVM ✓" : "Connect Wallet"}
      />
    </div>
  );
}