"use client";

import { useState } from "react";

export default function InfoStrip() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

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
          onClick={() => setVisible(false)}
          className="text-muted hover:text-white transition-colors shrink-0 leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}