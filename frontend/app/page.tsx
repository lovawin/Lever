export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-5xl font-black tracking-tight">
        Lever<span className="text-bull">.</span>
      </h1>
      <p className="text-muted mt-2 text-lg">long the runner · short the rug</p>

      <div className="mt-12 panel border border-border rounded-lg p-6">
        <div className="text-xs uppercase tracking-widest text-muted">status</div>
        <div className="text-2xl font-bold mt-2">MVP scaffolding only</div>
        <p className="text-muted mt-2 text-sm">
          Wallet connect, Hyperliquid integration, and signal scoring next.
        </p>
      </div>
    </main>
  );
}
