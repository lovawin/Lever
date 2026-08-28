"use client";

import { useAccount as useWagmiAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";

export default function WalletBar() {
  const { isConnected: evmConnected } = useWagmiAccount();
  const { publicKey, connected: solConnected, select, wallet, wallets, connect, connecting, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const solAddress = publicKey?.toBase58() ?? null;

  const [phantomInstalled, setPhantomInstalled] = useState(false);
  const [solflareInstalled, setSolflareInstalled] = useState(false);

  useEffect(() => {
    setPhantomInstalled(!!(window as any).solana?.isPhantom);
    setSolflareInstalled(!!(window as any).solflare);
  }, []);

  const handleSolConnect = useCallback(() => {
    if (solConnected && wallet) {
      disconnect();
      return;
    }
    const phantom = wallets.find(w => w.adapter.name === "Phantom");
    const solflare = wallets.find(w => w.adapter.name === "Solflare");
    const target = phantomInstalled && phantom ? phantom : solflareInstalled && solflare ? solflare : wallets[0];
    if (target) {
      select(target.adapter.name);
      setTimeout(() => connect(), 100);
    }
  }, [solConnected, wallet, wallets, phantomInstalled, solflareInstalled, select, connect, disconnect]);

  if (!mounted) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-28 rounded-lg bg-white/10 animate-pulse" />
        <div className="h-9 w-32 rounded-lg bg-white/10 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="[&_button]:!h-9 [&_button]:!text-xs [&_button]:!rounded-lg [&_button]:!font-semibold [&_button]:!border-white/10">
        <ConnectButton
          accountStatus="address"
          chainStatus="icon"
          showBalance={false}
          label={evmConnected ? "EVM " : "Connect EVM"}
        />
      </div>
      <button
        onClick={handleSolConnect}
        className="h-9 px-3.5 text-xs font-semibold rounded-lg transition-colors"
        style={{
          backgroundColor: solConnected ? "#9945FF" : "rgba(255,255,255,0.05)",
          border: solConnected ? "none" : "1px solid rgba(255,255,255,0.1)",
          color: "#f5f5f5",
        }}
      >
        {connecting
          ? "Connecting…"
          : solConnected && solAddress
            ? `SOL ${solAddress.slice(0, 4)}…${solAddress.slice(-4)}`
            : "Connect Solana"}
      </button>
    </div>
  );
}