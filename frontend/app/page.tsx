import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";
import PositionsPanel from "@/components/PositionsPanel";

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:py-16">
      <header className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight">
            Lever<span className="text-bull">.</span>
          </h1>
          <p className="text-muted mt-1 text-base md:text-lg">long the runner · short the rug</p>
        </div>
        <div className="pt-2">
          <WalletBar />
        </div>
      </header>

      <p className="text-muted text-sm leading-relaxed mb-6">
        Perp longs and shorts on Hyperliquid. Non-custodial — EVM wallet signs trades,
        Solana wallet for token-gated features later.
      </p>

      <TradePanel />
      <PositionsPanel />

      <footer className="mt-12 text-center text-xs text-muted">
        Hyperliquid testnet · MVP · not financial advice
      </footer>
    </main>
  );
}
