import TradePanel from "@/components/TradePanel";

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-6xl font-black tracking-tight">
        Lever<span className="text-bull">.</span>
      </h1>
      <p className="text-muted mt-2 text-lg">long the runner · short the rug</p>

      <p className="text-muted mt-6 text-sm leading-relaxed">
        Perp longs and shorts on Hyperliquid. Pick a memecoin, set size + leverage,
        click. Non-custodial — your wallet, your keys.
      </p>

      <TradePanel />

      <footer className="mt-16 text-center text-xs text-muted">
        Hyperliquid testnet · MVP · not financial advice
      </footer>
    </main>
  );
}
