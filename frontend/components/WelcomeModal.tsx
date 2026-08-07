"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "lever-welcome-dismissed";

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={dismiss}>
      <div
        className="relative w-full max-w-md glass rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-muted hover:text-white text-lg leading-none transition-colors"
        >
          ✕
        </button>

        {/* Title */}
        <h2 className="text-xl font-black mb-1">
          Welcome to Lever<span className="text-bull">.</span>
        </h2>
        <p className="text-sm text-muted mb-5">
          Long &amp; short memecoins with leverage — two modes, one app.
        </p>

        {/* Perps section */}
        <div className="glass rounded-xl p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-bull/10 text-bull text-sm font-bold">⚡</span>
            <div>
              <h3 className="text-sm font-bold leading-tight">HL Perps</h3>
              <span className="text-[10px] uppercase tracking-widest text-muted">EVM Wallet · Arbitrum</span>
            </div>
          </div>
          <ul className="text-xs text-muted space-y-1.5 leading-relaxed pl-9">
            <li>Long &amp; short with up to <span className="text-white font-medium">20× leverage</span></li>
            <li><strong className="text-white">Requires USDC on Arbitrum</strong> — MetaMask, Rabby, etc.</li>
            <li>Deposit USDC into the LeverVault smart contract</li>
            <li>Withdrawals are always <span className="text-bull font-bold">FREE</span> — non-custodial</li>
            <li className="text-yellow-400">⚠ Bridge or swap USDC to Arbitrum first</li>
          </ul>
        </div>

        {/* Spot section */}
        <div className="glass rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 text-sm font-bold">🌀</span>
            <div>
              <h3 className="text-sm font-bold leading-tight">Spot Leverage</h3>
              <span className="text-[10px] uppercase tracking-widest text-muted">Solana Wallet · Kamino + Jupiter</span>
            </div>
          </div>
          <ul className="text-xs text-muted space-y-1.5 leading-relaxed pl-9">
            <li>Long <span className="text-white font-medium">any Solana token</span> with leverage (1–5×)</li>
            <li>Borrow USDC from Kamino, swap via Jupiter — one click</li>
            <li><strong className="text-white">Requires SOL + SPL tokens</strong> — Phantom, Solflare, etc.</li>
            <li className="text-yellow-400">⚠ Make sure you have SOL for gas fees</li>
          </ul>
        </div>

        {/* CTA */}
        <button
          onClick={dismiss}
          className="w-full py-3 rounded-xl bg-bull text-black font-bold text-sm hover:bg-bull/90 transition-all"
        >
          Got it — let&apos;s trade
        </button>
        <p className="text-[10px] text-muted text-center mt-2">
          Not financial advice. Trading involves risk.
        </p>
      </div>
    </div>
  );
}