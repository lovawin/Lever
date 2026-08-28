"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet, Lock, ArrowRightLeft, CheckCircle2, Check } from "lucide-react";

// ─── Section Nav ──────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "intro", label: "Introduction" },
  { id: "why-lever", label: "Why Lever?" },
  { id: "custody", label: "Self-Custody" },
  { id: "how-it-works", label: "How It Works" },
  { id: "fees", label: "Fee Structure" },
  // Flash Loans removed — coming soon
  { id: "security", label: "Security" },
  { id: "math", label: "The Math" },
  { id: "compare", label: "Lever vs Others" },
  { id: "nft", label: "NFT Tiers" },
  { id: "risks", label: "Risks" },
];

export default function DocsPage() {
  const [active, setActive] = useState("intro");

  return (
    <div className="min-h-screen hero-gradient text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-black/60 sticky top-0 z-50">
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-xl font-black tracking-tight hover:opacity-80 transition">
              Lever<span className="text-bull">.</span>
            </Link>
            <span className="text-sm text-muted">Documentation</span>
          </div>
          <Link
            href="/"
            className="text-xs uppercase tracking-widest px-3 py-1.5 rounded-lg bg-bull/10 border border-bull/20 text-bull hover:bg-bull/20 transition-all"
          >
            ← Back to App
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-[1200px] flex gap-6 px-4 py-6">
        {/* Sidebar */}
        <aside className="hidden lg:block w-48 shrink-0 sticky top-20 self-start">
          <nav className="space-y-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setActive(s.id);
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-all ${
                  active === s.id
                    ? "bg-bull/10 text-bull font-bold border border-bull/20"
                    : "text-muted hover:text-white hover:bg-white/5"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 max-w-[800px] space-y-16">
          {/* ─── Introduction ──────────────────────────────────── */}
          <section id="intro" className="scroll-mt-24">
            <h1 className="text-3xl font-black mb-4">
              Lever Docs <span className="text-bull">↗</span>
            </h1>
            <p className="text-white/70 leading-relaxed mb-4">
              Lever is the first platform that lets you go <strong className="text-white">long or short on fresh memecoins</strong> with real leverage — not just spot swaps, not just perps on BTC/ETH. We combine on-chain vaults, Hyperliquid perps, and Solana spot leverage into one seamless trading experience.
            </p>
            <div className="bg-gradient-to-r from-bull/5 to-accent/5 border border-bull/20 rounded-xl p-5">
              <p className="text-sm font-bold text-bull mb-2">The Problem</p>
              <p className="text-sm text-white/70">
                Every day, hundreds of new memecoins launch on Solana. Traders want leverage on these tokens — but existing platforms only offer 1x spot swaps or perps on major coins. There&apos;s nowhere to get 5x, 10x, or 50x leverage on $PEPE, $WIF, $BONK, or the next viral coin.
              </p>
              <p className="text-sm font-bold text-accent mt-3 mb-2">The Solution</p>
              <p className="text-sm text-white/70">
                Lever gives you two ways to trade memecoins with leverage: <strong className="text-white">HL Perps</strong> for established coins and <strong className="text-white">Spot Leverage</strong> via Kamino/Jupiter for fresh Solana tokens. Flash Loans are <span className="text-yellow-400">coming soon</span>.
              </p>
            </div>
          </section>

          {/* ─── Why Lever ──────────────────────────────────────── */}
          <section id="why-lever" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Why Lever?</h2>
            <div className="grid gap-3">
              {[
                { emoji: "", title: "Fresh Memecoin Leverage", desc: "Trade the newest Solana tokens with up to 100x leverage via Lavarage, Kamino, and Jupiter. No waiting for perps to list." },
                { emoji: "", title: "Non-Custodial Vault", desc: "Your USDC sits in the LeverVault smart contract. You can ALWAYS withdraw — even when paused. Emergency withdraw, withdrawAll, and withdraw have no operator gate. The contract literally cannot refuse your withdrawal." },
                { emoji: "", title: "Free Withdrawals", desc: "Deposits and withdrawals are always free. We only charge on trades — open, close, and profit fees. No hidden spread." },
                { emoji: "", title: "3-Point Fee System", desc: "Open fee + close fee + profit fee (winning trades only). Losing trades only pay open+close. Diamond NFT holders pay zero." },
                { emoji: "", title: "Battle-Tested Contracts", desc: "LeverVault is deployed on Arbitrum with reentrancy guards, two-step ownership, emergency withdrawals, and full test coverage. FlashLoanReceiver coming soon." },
                { emoji: "", title: "Flash Loans — Coming Soon", desc: "Atomic arbitrage, self-liquidation, and leverage loops via Aave v3 flash loans on Arbitrum. Currently in development." },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="text-2xl">{item.emoji}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{item.title}</p>
                    <p className="text-xs text-white/50 mt-1">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Self-Custody ───────────────────────────────────── */}
          <section id="custody" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Self-Custody: How Your Funds Stay Yours</h2>

            <div className="bg-gradient-to-r from-bull/10 to-emerald-500/10 border border-bull/20 rounded-xl p-5 mb-6">
              <p className="text-sm text-white/80 leading-relaxed">
                <strong className="text-white">Lever does NOT hold your funds. </strong>
                Your USDC is deposited into the <strong className="text-bull">LeverVault smart contract</strong> on Arbitrum — a piece of code that <em>cannot</em> refuse your withdrawal. The contract guarantees:
              </p>
            </div>

            <div className="grid gap-3 mb-6">
              {[
                {
                  icon: "",
                  title: "You withdraw anytime — no one can stop you",
                  desc: "withdraw(), withdrawAll(), and emergencyWithdraw() have no operator check. No approval needed. No cooldown. No gatekeeper. Your USDC, your call. The contract LITERALLY cannot refuse.",
                },
                {
                  icon: "",
                  title: "Emergency withdraw works even when paused",
                  desc: "If the owner pauses the contract (blocks new deposits and position opens), you can STILL pull all your USDC out via emergencyWithdraw(). Pause stops new risk, not your exit.",
                },
                {
                  icon: "",
                  title: "Operators can't touch your balance",
                  desc: "Operators (Lever backend) can only deduct from your balance during openPosition() — and only the exact margin + fee amount. They can't arbitrarily drain you. Every deduction is on-chain and verifiable.",
                },
                {
                  icon: "",
                  title: "On-chain solvency verification",
                  desc: "Anyone can call isSolvent() or getSolvencyInfo() to verify that vault USDC balance ≥ total deposits. If the math doesn't add up, it's visible immediately.",
                },
                {
                  icon: "",
                  title: "Owner can't rug — rescueTokens blocks USDC",
                  desc: "The rescueTokens() function explicitly CANNOT withdraw USDC. It's only for recovering wrong tokens sent by accident. USDC only leaves via user withdrawals or fee transfers to the treasury.",
                },
                {
                  icon: "",
                  title: "All fees are capped on-chain",
                  desc: "Open/close fees are capped at 10% (1000 bps) max. Profit fees capped at 20% (2000 bps). The owner cannot set fees higher than these hard caps — it's enforced by the contract.",
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{item.title}</p>
                    <p className="text-xs text-white/50 mt-1">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Visual flow */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
              <p className="text-sm font-bold text-white mb-3">Where your USDC actually lives</p>
              <div className="space-y-3 text-sm font-mono">
                <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg">
                  <Wallet size={18} className="text-muted shrink-0" strokeWidth={1.5} />
                  <div className="flex-1">
                    <span className="text-white font-bold">Your Wallet</span>
                    <span className="text-white/30 ml-2">→ USDC here, you control it</span>
                  </div>
                  <span className="text-bull">Self-custody</span>
                </div>
                <div className="flex justify-center text-white/20">↓ deposit()</div>
                <div className="flex items-center gap-3 p-3 bg-bull/5 border border-bull/20 rounded-lg">
                  <Lock size={18} className="text-bull shrink-0" strokeWidth={1.5} />
                  <div className="flex-1">
                    <span className="text-white font-bold">LeverVault Contract</span>
                    <span className="text-white/30 ml-2">→ USDC locked on Arbitrum</span>
                  </div>
                  <span className="text-bull">You can always withdraw</span>
                </div>
                <div className="flex justify-center text-white/20">↓ openPosition()</div>
                <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg">
                  <ArrowRightLeft size={18} className="text-muted shrink-0" strokeWidth={1.5} />
                  <div className="flex-1">
                    <span className="text-white font-bold">HL Master Account</span>
                    <span className="text-white/30 ml-2">→ Margin sent to Hyperliquid</span>
                  </div>
                  <span className="text-white/30">operator only</span>
                </div>
                <div className="flex justify-center text-white/20">↓ closePosition()</div>
                <div className="flex items-center gap-3 p-3 bg-bull/5 border border-bull/20 rounded-lg">
                  <CheckCircle2 size={18} className="text-bull shrink-0" strokeWidth={1.5} />
                  <div className="flex-1">
                    <span className="text-white font-bold">Back to LeverVault</span>
                    <span className="text-white/30 ml-2">→ Margin + profit returned to your balance</span>
                  </div>
                  <span className="text-bull">You withdraw anytime</span>
                </div>
              </div>
            </div>

            {/* Not your keys warning */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
              <p className="text-sm font-bold text-white mb-3"> Honest disclosure: It's a smart contract, not your wallet</p>
              <p className="text-sm text-white/60 leading-relaxed mb-3">
                "Self-custodial" means the <strong className="text-white">contract code</strong> guarantees your withdrawal rights — not that USDC sits in your personal wallet during a trade. Here's the nuance:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <Check size={16} className="text-bull shrink-0 mt-0.5" strokeWidth={2} />
                  <span className="text-white/70"><strong className="text-white">Deposited USDC:</strong> sits in LeverVault on Arbitrum. You can withdraw it anytime via the contract — no approval, no delay, no minimums beyond $0.01.</span>
                </div>
                <div className="flex gap-2">
                  <Check size={16} className="text-bull shrink-0 mt-0.5" strokeWidth={2} />
                  <span className="text-white/70"><strong className="text-white">Open position margin:</strong> sent to the HL master account on Hyperliquid. When the position closes, margin + profit (minus fees) returns to your LeverVault balance.</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-yellow-400">!</span>
                  <span className="text-white/70"><strong className="text-white">During an open trade:</strong> your margin is on Hyperliquid, not in the vault. You can't withdraw mid-trade (that would be pulling margin from an active position). Close the position first, then withdraw.</span>
                </div>
                <div className="flex gap-2">
                  <Check size={16} className="text-bull shrink-0 mt-0.5" strokeWidth={2} />
                  <span className="text-white/70"><strong className="text-white">Smart contract risk:</strong> Like all DeFi, there's smart contract risk. The contract has reentrancy guards, fee caps, and 74 tests — but bugs are always possible. Only deposit what you can afford to lose.</span>
                </div>
              </div>
            </div>

            {/* Quick comparison */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
              <p className="text-sm font-bold text-white mb-3">CEX vs Lever Vault</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-2 text-white/40">Feature</th>
                      <th className="text-center py-2 px-2 text-bull font-bold">LeverVault</th>
                      <th className="text-center py-2 px-2 text-white/40">CEX (Binance, etc.)</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-2">Can you withdraw anytime?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold">Always</td>
                      <td className="py-2 px-2 text-center text-white/30">Sometimes paused</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-2">Can the platform freeze funds?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold">No</td>
                      <td className="py-2 px-2 text-center text-white/30">Yes</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-2">Works when paused?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold">withdrawals work</td>
                      <td className="py-2 px-2 text-center text-white/30">everything frozen</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-2">Withdrawal fees?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold">FREE</td>
                      <td className="py-2 px-2 text-center text-white/30">Varies</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-2">Verifiable on-chain?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold"></td>
                      <td className="py-2 px-2 text-center text-white/30"></td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2">Can owner steal USDC?</td>
                      <td className="py-2 px-2 text-center text-bull font-bold">No (rescueTokens blocked)</td>
                      <td className="py-2 px-2 text-center text-white/30">Can freeze/seize</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ─── How It Works ──────────────────────────────────── */}
          <section id="how-it-works" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">How It Works</h2>

            <h3 className="text-lg font-bold mb-2 text-bull">HL Perps Mode</h3>
            <p className="text-sm text-white/60 mb-3">
              Trade Hyperliquid perpetuals through Lever. Your margin sits in the LeverVault on Arbitrum, and our operator opens/closes positions on Hyperliquid on your behalf.
            </p>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6 font-mono text-xs text-white/60">
              <div className="text-bull font-bold mb-2 text-sm font-sans">Flow: HL Perps Trade</div>
              <div className="space-y-1">
                <div>1. You deposit USDC → LeverVault (Arbitrum)</div>
                <div>2. You select coin + side (long/short) + leverage</div>
                <div>3. Lever operator opens position on Hyperliquid</div>
                <div>4. HL margin account trades with your capital</div>
                <div>5. Close when ready → operator settles → profit/loss to vault</div>
              </div>
            </div>

            <h3 className="text-lg font-bold mb-2 text-accent">Spot Leverage Mode</h3>
            <p className="text-sm text-white/60 mb-3">
              Get leverage on fresh Solana tokens that don&apos;t have perps yet — including pump.fun launches. No external API key needed.
            </p>
            <div className="space-y-2 mb-6">
              {[
                { tier: "Step 1", label: "Kamino Setup", desc: "Create obligation account with SOL as collateral.", color: "text-bull" },
                { tier: "Step 2", label: "Kamino Borrow", desc: "Borrow USDC against your SOL collateral at your chosen leverage (2x–10x).", color: "text-accent" },
                { tier: "Step 3", label: "Jupiter Swap", desc: "Swap borrowed USDC → your target memecoin. Works on ANY Solana token including pump.fun.", color: "text-accent" },
              ].map((t) => (
                <div key={t.tier} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className={`text-xs font-bold ${t.color}`}>{t.tier}</span>
                  <span className="text-sm font-bold text-white">{t.label}</span>
                  <span className="text-xs text-white/40">— {t.desc}</span>
                </div>
              ))}
            </div>
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-6">
              <p className="text-sm font-bold text-accent mb-1">How Custom Leverage Works</p>
              <p className="text-xs text-white/50">
                No Lavarage API key required. We built our own leverage engine using Kamino lending markets + Jupiter swaps. Deposit SOL, borrow USDC, swap to any memecoin. True leverage on pump.fun tokens, Jupiter launches, and any SPL token.
              </p>
            </div>

            <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-6">
              <p className="text-sm font-bold text-accent mb-2">Cross-Chain Bridge for EVM Users</p>
              <p className="text-xs text-white/50 mb-3">
                Don&apos;t have a Solana wallet? No problem. If you have MetaMask, Rainbow, or any EVM wallet with USDC on Arbitrum, you can still use Spot Leverage.
              </p>
              <div className="space-y-2 text-xs text-white/60 font-mono">
                <div>1. We auto-generate a Solana wallet for you (encrypted in your browser)</div>
                <div>2. You bridge USDC from Arbitrum → Solana via deBridge</div>
                <div>3. Once bridged, we swap USDC → SOL and run the leverage engine</div>
                <div>4. You get a leveraged memecoin position without ever leaving your EVM wallet</div>
              </div>
              <p className="text-xs text-white/30 mt-3">
                Powered by deBridge DLN protocol. Your Solana private key is generated client-side and encrypted with AES-GCM in your browser&apos;s localStorage. Only you can access it.
              </p>
            </div>

            <h3 className="text-lg font-bold mb-2 text-yellow-400">Flash Loans — Coming Soon</h3>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 font-mono text-xs text-white/60">
              <div className="text-yellow-400 font-bold mb-2 text-sm font-sans">Flash Loan Mode</div>
              <div className="space-y-1">
                <div>Atomic strategies on Arbitrum via Aave v3 flash loans.</div>
                <div>Features in development: arbitrage, self-liquidation, leverage loops.</div>
                <div>Stay tuned — coming soon.</div>
              </div>
            </div>
          </section>

          {/* ─── Fee Structure ──────────────────────────────────── */}
          <section id="fees" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Fee Structure</h2>
            <p className="text-sm text-white/60 mb-6">
              Lever uses a <strong className="text-white">3-point fee system</strong>: open fee + close fee + profit fee (winning trades only). Losing trades only pay open + close. Withdrawals are always free.
            </p>

            {/* Fee table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-3 text-white/40 text-xs uppercase tracking-wider">Tier</th>
                    <th className="text-right py-2 px-3 text-white/40 text-xs uppercase tracking-wider">Open</th>
                    <th className="text-right py-2 px-3 text-white/40 text-xs uppercase tracking-wider">Close</th>
                    <th className="text-right py-2 px-3 text-white/40 text-xs uppercase tracking-wider">Profit</th>
                    <th className="text-right py-2 px-3 text-white/40 text-xs uppercase tracking-wider">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { tier: "Iron", open: "4.5%", close: "4.5%", profit: "9%", savings: "—", color: "text-gray-300" },
                    { tier: "Silver", open: "3.75%", close: "3.75%", profit: "7.5%", savings: "17%", color: "text-white/70" },
                    { tier: "Gold", open: "2.5%", close: "2.5%", profit: "5%", savings: "44%", color: "text-yellow-400" },
                    { tier: "Diamond", open: "0%", close: "0%", profit: "0%", savings: "100%", color: "text-cyan-400" },
                  ].map((row) => (
                    <tr key={row.tier} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className={`py-2 px-3 font-bold ${row.color}`}>{row.tier}</td>
                      <td className="py-2 px-3 text-right font-mono text-white/70">{row.open}</td>
                      <td className="py-2 px-3 text-right font-mono text-white/70">{row.close}</td>
                      <td className="py-2 px-3 text-right font-mono text-white/70">{row.profit}</td>
                      <td className="py-2 px-3 text-right font-mono text-bull">{row.savings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Fee example */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
              <p className="text-sm font-bold text-white mb-3">Example: $1,000 trade with 10x leverage ($10,000 notional) — Iron Tier</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-white/50">Notional (margin × leverage)</span>
                  <span className="text-white">$10,000</span>
                </div>
                <div className="border-t border-white/5 pt-2" />
                <div className="flex justify-between">
                  <span className="text-white/50">Open fee (4.5%)</span>
                  <span className="text-bear">$450</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Close fee (4.5%)</span>
                  <span className="text-bear">$450</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Profit fee (9%, on winning trades only)</span>
                  <span className="text-bear">$1,000 profit × 9% = $90</span>
                </div>
                <div className="border-t border-white/5 pt-2" />
                <div className="flex justify-between font-bold">
                  <span className="text-white/50">Total fees (winning trade)</span>
                  <span className="text-white">$450 + $450 + $90 = $990</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Total fees (losing trade)</span>
                  <span className="text-white">$450 + $450 = $900 (no profit fee)</span>
                </div>
                <div className="border-t border-white/5 pt-2" />
                <div className="flex justify-between text-bull">
                  <span>Withdrawal fee</span>
                  <span>FREE — always</span>
                </div>
              </div>
            </div>

            {/* Diamond savings */}
            <div className="mt-4 bg-gradient-to-r from-cyan-500/5 to-accent/5 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm font-bold text-cyan-400 mb-1">Diamond Tier = Zero Fees</p>
              <p className="text-xs text-white/50">
                Diamond NFT holders pay 0% open, 0% close, and 0% profit fee. Plus 25% funding rebates and 25% revenue share from the platform. It&apos;s like owning a piece of the house.
              </p>
            </div>
          </section>

          {/* ─── Security ──────────────────────────────────────── */}
          <section id="security" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Security</h2>
            <div className="grid gap-3 mb-6">
              {[
                { icon: "", title: "Non-Custodial", desc: "LeverVault holds your USDC on Arbitrum. You can withdraw anytime — even if the protocol is paused. Emergency withdraw is always available." },
                { icon: "", title: "ReentrancyGuard", desc: "LeverVault uses reentrancy guards on all external-facing functions. No re-entrancy attacks." },
                { icon: "⏸", title: "Pausable", desc: "Owner can pause all operations in an emergency. Emergency withdrawals work even when paused." },
                { icon: "", title: "Emergency Withdraw", desc: "Pull ALL tokens out instantly — USDC, ETH, any ERC20. Your escape hatch that never goes away." },
                { icon: "", title: "Two-Step Ownership", desc: "Ownership transfers require the new owner to accept. No accidentally sending control to the wrong address." },
                { icon: "", title: "50 Tests Passing", desc: "LeverVault: 50 tests. Full coverage on deposits, withdrawals, positions, fees, emergency actions, and access control." },
                { icon: "", title: "Verified Contracts", desc: "All contracts deployed on Arbitrum One. Source code verifiable on Arbiscan." },
              ].map((item) => (
                <div key={item.title} className="flex gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="text-lg">{item.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{item.title}</p>
                    <p className="text-xs text-white/50">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Contract Addresses (Arbitrum One)</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                  <span className="text-white/50">LeverVault</span>
                  <a href="https://arbiscan.io/address/0xe7ed6455fc473bba35ee573d20e8c3e80d7c6801" target="_blank" rel="noopener noreferrer" className="text-bull hover:underline break-all">0xe7ed6455fc473bba35ee573d20e8c3e80d7c6801</a>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                  <span className="text-white/50">FlashLoanReceiver</span>
                  <span className="text-yellow-400/70">Coming Soon</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                  <span className="text-white/50">Treasury</span>
                  <a href="https://arbiscan.io/address/0xf8E3385029d4f1B374B17781D971971ADec6D7C5" target="_blank" rel="noopener noreferrer" className="text-bull hover:underline break-all">0xf8E3385029d4f1B374B17781D971971ADec6D7C5</a>
                </div>
              </div>
            </div>
          </section>

          {/* ─── The Math ──────────────────────────────────────── */}
          <section id="math" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">The Math</h2>

            <h3 className="text-lg font-bold mb-2 text-white">Position P&L</h3>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
              <div className="space-y-3 text-sm font-mono">
                <div>
                  <span className="text-white/40">Long PnL = </span>
                  <span className="text-white">exitPrice − entryPrice) × positionSize</span>
                </div>
                <div>
                  <span className="text-white/40">Short PnL = </span>
                  <span className="text-white">(entryPrice − exitPrice) × positionSize</span>
                </div>
                <div className="border-t border-white/5 pt-3" />
                <div>
                  <span className="text-white/40">positionSize = </span>
                  <span className="text-white">margin × leverage</span>
                </div>
                <div>
                  <span className="text-white/40">notional = </span>
                  <span className="text-white">margin × leverage</span>
                </div>
              </div>
            </div>

            <h3 className="text-lg font-bold mb-2 text-white">Fee Calculations (Iron Tier)</h3>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
              <div className="space-y-2 text-sm font-mono">
                <div>
                  <span className="text-white/40">openFee = </span>
                  <span className="text-white">notional × 4.5%</span>
                </div>
                <div>
                  <span className="text-white/40">closeFee = </span>
                  <span className="text-white">notional × 4.5%</span>
                </div>
                <div>
                  <span className="text-white/40">profitFee = </span>
                  <span className="text-white">max(0, PnL) × 9%</span>
                  <span className="text-white/30"> // only on winning trades</span>
                </div>
                <div className="border-t border-white/5 pt-2" />
                <div>
                  <span className="text-white/40">totalFee (win) = </span>
                  <span className="text-white">openFee + closeFee + profitFee</span>
                </div>
                <div>
                  <span className="text-white/40">totalFee (lose) = </span>
                  <span className="text-white">openFee + closeFee</span>
                  <span className="text-white/30"> // no profit fee on losses</span>
                </div>
              </div>
            </div>

            <h3 className="text-lg font-bold mb-2 text-white">Break-Even Analysis</h3>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
              <p className="text-sm text-white/60 mb-3">
                For a trade to be profitable, the price must move enough to cover the fees:
              </p>
              <div className="space-y-2 text-sm font-mono">
                <div>
                  <span className="text-bull">breakEvenMove = </span>
                  <span className="text-white">totalFees / positionSize</span>
                </div>
                <div className="border-t border-white/5 pt-2" />
                <div className="text-white/50 text-xs">
                  Example: $100 margin, 10x leverage → $1,000 notional
                </div>
                <div className="text-white/50 text-xs">
                  Fees: $45 (open) + $45 (close) = $90 total (losing trade)
                </div>
                <div className="text-xs">
                  <span className="text-white/40">breakEven = </span>
                  <span className="text-bull">$90 / $1,000 = 9%</span>
                </div>
                <div className="text-white/50 text-xs">
                  With Diamond NFT: $0 fees → 0% break-even → profitable from the first tick
                </div>
              </div>
            </div>


          </section>

          {/* ─── Comparison ─────────────────────────────────────── */}
          <section id="compare" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Lever vs Others</h2>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-white/40">Feature</th>
                    <th className="text-center py-2 px-2 text-bull font-bold">Lever</th>
                    <th className="text-center py-2 px-2 text-white/40">dYdX</th>
                    <th className="text-center py-2 px-2 text-white/40">GMX</th>
                    <th className="text-center py-2 px-2 text-white/40">Jupiter</th>
                  </tr>
                </thead>
                <tbody className="text-white/70">
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Fresh memecoin leverage</td>
                    <td className="py-2 px-2 text-center text-bull font-bold"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30">1x only</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Non-custodial vault</td>
                    <td className="py-2 px-2 text-center text-bull font-bold"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Free withdrawals</td>
                    <td className="py-2 px-2 text-center text-bull font-bold"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Flash loan arbitrage</td>
                    <td className="py-2 px-2 text-center text-yellow-400">Coming Soon</td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Emergency withdraw</td>
                    <td className="py-2 px-2 text-center text-bull font-bold"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">NFT fee discounts</td>
                    <td className="py-2 px-2 text-center text-bull font-bold"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                    <td className="py-2 px-2 text-center text-white/30"></td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-2 px-2">Multi-chain</td>
                    <td className="py-2 px-2 text-center text-bull">Arb + Sol</td>
                    <td className="py-2 px-2 text-center text-white/30">1 chain</td>
                    <td className="py-2 px-2 text-center text-white/30">Multi</td>
                    <td className="py-2 px-2 text-center text-white/30">Sol only</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-bull/5 border border-bull/20 rounded-xl p-4">
              <p className="text-sm font-bold text-bull mb-1">The Key Difference</p>
              <p className="text-xs text-white/60">
                No other platform lets you leverage <em>fresh</em> memecoins. Perps on dYdX and GMX only cover BTC, ETH, and major coins. Jupiter gives you spot swaps at 1x. Lever gives you 5x–100x on the tokens that just launched — the ones with the most volatility and opportunity.
              </p>
            </div>
          </section>

          {/* ─── NFT Tiers ─────────────────────────────────────── */}
          <section id="nft" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">NFT Tiers</h2>
            <p className="text-sm text-white/60 mb-4">
              Lever NFTs reduce your trading fees and unlock revenue sharing. 10,000 generative PFPs launching soon.
            </p>
            <div className="space-y-3">
              {[
                { tier: "Iron", price: "0.03 ETH", open: "4.5%", profit: "9%", color: "border-gray-400/20 bg-gray-400/5", dot: "bg-gray-200", desc: "10% fee discount." },
                { tier: "Silver", price: "0.06 ETH", open: "3.75%", profit: "7.5%", color: "border-white/10 bg-white/[0.02]", dot: "bg-white/70", desc: "25% fee discount." },
                { tier: "Gold", price: "0.1 ETH", open: "2.5%", profit: "5%", color: "border-yellow-500/20 bg-yellow-500/5", dot: "bg-yellow-400", desc: "50% fee discount + 15% funding rebate. Serious trader." },
                { tier: "Diamond", price: "0.3 ETH", open: "0%", profit: "0%", color: "border-cyan-500/20 bg-cyan-500/5", dot: "bg-cyan-400", desc: "Zero fees + 25% funding rebate + 25% revenue share. You own a piece of the house." },
              ].map((nft) => (
                <div key={nft.tier} className={`p-4 rounded-xl border ${nft.color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${nft.dot}`} />
                      <span className="text-sm font-bold text-white">{nft.tier}</span>
                      <span className="text-xs text-white/30">{nft.price}</span>
                    </div>
                    <div className="flex gap-3 text-xs font-mono">
                      <span className="text-white/50">Open: <span className="text-white">{nft.open}</span></span>
                      <span className="text-white/50">Profit: <span className="text-white">{nft.profit}</span></span>
                    </div>
                  </div>
                  <p className="text-xs text-white/40">{nft.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Risks ────────────────────────────────────────── */}
          <section id="risks" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Risks</h2>
            <div className="space-y-3">
              {[
                { icon: "", title: "Liquidation Risk", desc: "Leveraged positions can be liquidated if price moves against you. Use stop-losses and manage position size carefully." },
                { icon: "", title: "Fee Impact", desc: "At 4.5% open + 4.5% close (Iron tier), you need the price to move >9% in your favor just to break even on a 1x trade. Higher leverage means smaller break-even moves." },
                { icon: "", title: "Smart Contract Risk", desc: "While audited and tested, smart contracts carry inherent risk. Only deposit what you can afford to lose. Emergency withdraw is your safety net." },
                { icon: "", title: "Cross-Chain Risk", desc: "HL perps run on Hyperliquid, spot leverage on Solana. Each chain has its own risks including downtime and congestion." },
              ].map((r) => (
                <div key={r.title} className="flex gap-3 p-3 bg-white/[0.02] border border-bear/10 rounded-xl">
                  <span className="text-lg">{r.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{r.title}</p>
                    <p className="text-xs text-white/50">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div className="border-t border-white/5 pt-6 pb-12 text-center">
            <p className="text-xs text-white/20">
              Lever Protocol — Built on Arbitrum + Solana · Contracts verified on Arbiscan
            </p>
            <div className="mt-2 flex justify-center gap-4">
              <a href="https://arbiscan.io/address/0xe7ed6455fc473bba35ee573d20e8c3e80d7c6801" target="_blank" rel="noopener noreferrer" className="text-xs text-bull/50 hover:text-bull transition">Vault</a>
              <Link href="/" className="text-xs text-bull/50 hover:text-bull transition">Trade</Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}