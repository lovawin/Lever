"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "lever-info-dismissed";

export default function InfoStrip() {
  // null = not yet hydrated (show), true = dismissed (hide), false = not dismissed (show)
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const val = localStorage.getItem(STORAGE_KEY);
    setDismissed(val === "1");
  }, []);

  // Don't render until hydration finishes to avoid mismatch
  if (dismissed === null) return null;

  if (dismissed) return null;

  return (
    <div className="border-b border-white/5 bg-white/[0.02]">
      <div className="mx-auto max-w-[1600px] px-4 py-2 flex items-start gap-3 text-[11px] text-muted">
        <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="text-bull font-bold text-[10px]">⚡ PERPS</span>
            EVM wallet · USDC on Arbitrum
          </span>
          <span className="text-white/10 hidden sm:inline">|</span>
          <span className="flex items-center gap-1">
            <span className="text-purple-400 font-bold text-[10px]">🌀 SPOT</span>
            Solana wallet · SOL + SPL tokens
          </span>
          <span className="text-white/10 hidden sm:inline">|</span>
          <span className="text-yellow-400/80">Withdrawals always free · Non-custodial</span>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, "1");
            setDismissed(true);
          }}
          className="text-muted hover:text-white transition-colors shrink-0 leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}