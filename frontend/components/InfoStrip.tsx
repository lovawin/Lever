"use client";

import { useState } from "react";

export default function InfoStrip() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-bold mb-2">How Lever Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white/[0.03] border border-bull/20 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-bull font-bold text-xs">⚡ Perps</span>
                <span className="text-[10px] text-muted">EVM · Arbitrum</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Long & short memecoins up to 20×. Requires <strong className="text-white">USDC on Arbitrum</strong> in your EVM wallet.
              </p>
            </div>
            <div className="bg-white/[0.03] border border-purple-400/20 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-purple-400 font-bold text-xs">🌀 Spot</span>
                <span className="text-[10px] text-muted">Solana · Kamino</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Leverage on any Solana token. Deposit <strong className="text-white">SOL</strong> in your Solana wallet — Kamino borrows &amp; swaps for you. No USDC needed.
              </p>
            </div>
          </div>
          <p className="text-[10px] text-bull mt-2">Withdrawals always free · Non-custodial vault</p>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-muted hover:text-white transition-colors shrink-0 text-sm leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}