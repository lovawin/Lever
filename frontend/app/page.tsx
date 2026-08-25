"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";

import ErrorBoundary from "@/components/ErrorBoundary";
import OrderBook from "@/components/OrderBook";
import PriceChart from "@/components/PriceChart";
import FundingRate from "@/components/FundingRate";
import PositionsPanel from "@/components/PositionsPanel";
import { getAllMids } from "@/lib/hyperliquid";
import {
  searchTokens,
  getSolPrice,
  getJupiterQuote,
  getJupiterSwapTx,
  signAndSendTransaction,
  USDC_MINT,
  SOL_MINT,
  usdcToRaw,
  solToRaw,
  type TokenSearchResult,
  type LeverageResult,
} from "@/lib/leverage";
import {
  openCustomLeveragePosition,
  estimateCustomLeverage,
  type CustomLeverageEstimate,
} from "@/lib/custom-leverage";
import {
  openBorrowLeveragePosition,
  estimateBorrowLeverage,
  getUserObligations,
  type BorrowLeverageResult,
  type KaminoObligation,
} from "@/lib/kamino-borrow";
import {
  generateSolanaWallet,
  getStoredSolanaWallet,
  bridgeEvmToSolana,
  waitForBridgeCompletion,
  sendBridgeTx,
  approveUsdc,
  getOrderIdByTxHash,
} from "@/lib/cross-chain";
import { useAccount as useWagmiAccount, useWriteContract, usePublicClient } from "wagmi";

export default function Page() {
  const [tab, setTab] = useState<"perps" | "leverage" | "flash">("perps");
  const [selectedCoin, setSelectedCoin] = useState("PURR");
  const [mids, setMids] = useState<Record<string, string>>({});

  // ─── Spot leverage state ────────────────────────────────────────────────
  const [solQuery, setSolQuery] = useState("");
  const [solResults, setSolResults] = useState<TokenSearchResult[]>([]);
  const [solSearching, setSolSearching] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenSearchResult | null>(null);

  // Fetch HL mid prices
  useEffect(() => {
    let alive = true;
    async function fetchMids() {
      try {
        const data = await getAllMids(false);
        if (alive) setMids(data);
      } catch {}
    }
    fetchMids();
    const iv = setInterval(fetchMids, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Spot leverage token search
  useEffect(() => {
    if (!solQuery.trim()) {
      setSolResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setSolSearching(true);
      try {
        const results = await searchTokens(solQuery);
        if (alive) setSolResults(results.slice(0, 20));
      } catch {
        if (alive) setSolResults([]);
      } finally {
        if (alive) setSolSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [solQuery]);

  return (
    <div className="min-h-screen hero-gradient flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-[1100px] flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">
              Lever<span className="text-bull">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              <span className="text-[10px] uppercase tracking-widest text-bull">Live</span>
            </div>
            <WalletBar />
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="mx-auto max-w-[1100px] w-full px-4 pt-4">
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <button
            onClick={() => setTab("perps")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "perps"
                ? "bg-bull/15 text-bull border border-bull/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            ⚡ Perps
          </button>
          <button
            onClick={() => setTab("leverage")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "leverage"
                ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            🌀 Spot Leverage
          </button>
          <button
            onClick={() => setTab("flash")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "flash"
                ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            💎 Flash Loans
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[1100px] w-full px-4 py-4 flex-1">
        {tab === "perps" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left column: Coin selector + Trade */}
            <div className="lg:col-span-4 space-y-4">
              <div className="glass rounded-2xl p-4">
                <CoinSelector selected={selectedCoin} onSelect={setSelectedCoin} mids={mids} />
              </div>
              <div className="glass rounded-2xl p-5">
                <ErrorBoundary name="Trade">
                  <TradePanel mids={mids} selectedCoin={selectedCoin} onCoinChange={setSelectedCoin} />
                </ErrorBoundary>
              </div>
            </div>
            {/* Center: Chart + Order Book */}
            <div className="lg:col-span-5 space-y-4">
              <ErrorBoundary name="Chart">
                <PriceChart coin={selectedCoin} />
              </ErrorBoundary>
              <ErrorBoundary name="OrderBook">
                <OrderBook coin={selectedCoin} midPrice={mids[selectedCoin]} />
              </ErrorBoundary>
            </div>
            {/* Right: Funding + Positions */}
            <div className="lg:col-span-3 space-y-4">
              <ErrorBoundary name="Funding">
                <FundingRate coin={selectedCoin} />
              </ErrorBoundary>
              <ErrorBoundary name="Positions">
                <PositionsPanel />
              </ErrorBoundary>
            </div>
          </div>
        ) : tab === "leverage" ? (
          <div className="mx-auto max-w-[680px]">
            <div className="glass rounded-2xl p-5">
              <SpotLeveragePanel
                query={solQuery}
                setQuery={setSolQuery}
                results={solResults}
                searching={solSearching}
                selectedToken={selectedToken}
                setSelectedToken={setSelectedToken}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[680px]">
            <div className="glass rounded-2xl p-5">
              <div className="text-center py-16">
                <div className="text-5xl mb-4">💎</div>
                <h2 className="text-xl font-black mb-2">Flash Loans</h2>
                <p className="text-sm text-muted max-w-sm mx-auto">
                  Atomic flash loan strategies on Arbitrum — arbitrage, self-liquidation, and leverage loops. Powered by Aave v3.
                </p>
                <div className="mt-4 inline-block px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-muted">
                  🔄 Coming Soon
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Perps · Spot Leverage · Flash Loans — memecoin-native leverage</span>
          <span>Lever Protocol</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Perps Coin Selector ────────────────────────────────────────────────────

const MEMECOIN_PERPS = [
  "PURR", "WIF", "BRETT", "SPX", "TRUMP", "DOGE", "TURBO", "MEME",
  "kPEPE", "kFLOKI", "kSHIB", "kBONK", "PURR/USDC",
];

const MEME_KEYWORDS = [
  "PEPE", "DOGE", "SHIB", "FLOKI", "BONK", "WIF", "BRETT", "PURR",
  "TRUMP", "MOG", "TURBO", "MEME", "SPX", "MAGA", "FIGHT", "KENDU",
  "BODEN", "TREMP", "JEFF", "RAGE", "BALD", "POPE", "GIGA",
];

function isLikelyMemecoin(name: string): boolean {
  if (MEMECOIN_PERPS.includes(name)) return true;
  const upper = name.toUpperCase();
  return MEME_KEYWORDS.some(kw => upper.includes(kw));
}

function CoinSelector({ selected, onSelect, mids }: { selected: string; onSelect: (c: string) => void; mids: Record<string, string> }) {
  const [search, setSearch] = useState("");

  const allCoins = Object.keys(mids).filter(c => !c.startsWith("#") && !c.startsWith("@"));
  const memecoinList = allCoins.filter(isLikelyMemecoin).sort((a, b) => {
    const aKnown = MEMECOIN_PERPS.includes(a) ? 0 : 1;
    const bKnown = MEMECOIN_PERPS.includes(b) ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.localeCompare(b);
  });

  const filtered = search.trim()
    ? allCoins.filter(c => c.toLowerCase().includes(search.toLowerCase())).slice(0, 50)
    : memecoinList.slice(0, 40);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold">Asset</h2>
        <span className="text-[10px] text-muted">{filtered.length} markets</span>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search any perp market..."
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
      />
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {filtered.length === 0 && <span className="text-xs text-muted py-2">No markets found</span>}
        {filtered.map(name => {
          const mid = mids[name];
          const midNum = mid ? parseFloat(mid) : 0;
          return (
            <button
              key={name}
              onClick={() => { onSelect(name); setSearch(""); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
                selected === name
                  ? "bg-bull/15 text-bull border border-bull/30"
                  : "bg-white/[0.03] text-muted border border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="font-bold">{name}</span>
              {midNum > 0 && (
                <span className="ml-1 text-[10px] opacity-60">
                  ${midNum >= 1 ? midNum.toFixed(2) : midNum < 0.001 ? midNum.toExponential(1) : midNum.toPrecision(3)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Spot Leverage Panel ────────────────────────────────────────────────────

function SpotLeveragePanel({
  query, setQuery, results, searching, selectedToken, setSelectedToken,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: TokenSearchResult[];
  searching: boolean;
  selectedToken: TokenSearchResult | null;
  setSelectedToken: (t: TokenSearchResult | null) => void;
}) {
  const { publicKey, connected, wallet } = useWallet();
  const { connection } = useConnection();
  const { isConnected: evmConnected, address: evmAddress } = useWagmiAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Leverage form state
  const [collateralSol, setCollateralSol] = useState(0.5);
  const [leverage, setLeverage] = useState(3);
  const [slippage, setSlippage] = useState(1);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<LeverageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [obligations, setObligations] = useState<KaminoObligation[]>([]);

  // ─── Cross-chain bridge state ─────────────────────────────────────
  const [autoSolWallet, setAutoSolWallet] = useState<string | null>(null);
  const [bridgeUsdcAmount, setBridgeUsdcAmount] = useState(50);
  const [bridgeStep, setBridgeStep] = useState<
    "idle" | "approving" | "bridging" | "waiting" | "swapping" | "leveraging" | "done"
  >("idle");
  const [bridgeStatus, setBridgeStatus] = useState<string>("");
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // Detect: EVM connected, Solana NOT connected = cross-chain user
  const isEvmOnly = evmConnected && !!evmAddress && !connected;
  const isSolanaConnected = connected && !!publicKey;

  // Fetch SOL price when token selected
  useEffect(() => {
    if (!selectedToken) return;
    let alive = true;
    getSolPrice().then(p => { if (alive) setSolPrice(p); }).catch(() => {});
    return () => { alive = false; };
  }, [selectedToken]);

  // Auto-generate Solana wallet for EVM-only users
  useEffect(() => {
    if (isEvmOnly && !autoSolWallet) {
      generateSolanaWallet().then(({ publicKey }) => {
        setAutoSolWallet(publicKey);
      }).catch(() => {});
    }
  }, [isEvmOnly, autoSolWallet]);

  // Reset state when token changes
  useEffect(() => {
    setResult(null);
    setError(null);
    setExecuting(false);
    setBridgeStep("idle");
    setBridgeError(null);
  }, [selectedToken?.mint]);

  // Fetch user's Kamino obligations
  useEffect(() => {
    if (!connected || !publicKey) {
      setObligations([]);
      return;
    }
    let alive = true;
    getUserObligations(publicKey.toBase58())
      .then(obs => { if (alive) setObligations(obs); })
      .catch(() => { if (alive) setObligations([]); });
    const iv = setInterval(() => {
      getUserObligations(publicKey.toBase58())
        .then(obs => { if (alive) setObligations(obs); })
        .catch(() => {});
    }, 15000); // refresh every 15s
    return () => { alive = false; clearInterval(iv); };
  }, [connected, publicKey, result]);

  // Calculate estimate — use bridged USDC for EVM users, SOL collateral for Solana users
  const effectiveCollateralSol = isEvmOnly && solPrice && bridgeUsdcAmount > 0
    ? bridgeUsdcAmount / solPrice
    : collateralSol;
  const estimate: CustomLeverageEstimate | null =
    solPrice && selectedToken && effectiveCollateralSol > 0
      ? estimateCustomLeverage(effectiveCollateralSol, leverage, solPrice, selectedToken.priceUsd)
      : null;

  // ─── Cross-chain bridge + leverage execution ────────────────────────
  const handleBridgeAndLeverage = useCallback(async () => {
    if (!selectedToken) return;
    if (!evmAddress) {
      setBridgeError("Connect your EVM wallet first (MetaMask/Rainbow).");
      return;
    }
    if (!autoSolWallet) {
      setBridgeError("Generating Solana wallet… please wait.");
      return;
    }
    if (bridgeUsdcAmount <= 0) {
      setBridgeError("Enter a valid USDC amount to bridge.");
      return;
    }

    setBridgeError(null);
    setBridgeStep("approving");
    setBridgeStatus("Step 1/4: Checking USDC approval for deBridge router…");

    try {
      // Step 1: Create the bridge order via deBridge API (enableEstimate=false so it doesn't check balance)
      setBridgeStatus("Step 1/4: Creating deBridge order (Arbitrum → Solana)…");
      const bridgeOrder = await bridgeEvmToSolana({
        evmAddress,
        solanaRecipient: autoSolWallet,
        usdcAmount: bridgeUsdcAmount,
      });

      // Step 2: Send the bridge transaction via EVM wallet (no approval needed — deBridge uses permit flow)
      setBridgeStep("bridging");
      setBridgeStatus("Step 2/4: Sign the bridge transaction in your EVM wallet…");
      const txHash = await sendBridgeTx(bridgeOrder.tx, evmAddress);

      // Get the deBridge order ID from the tx hash
      setBridgeStatus("Step 2/4: Bridge transaction submitted. Finding order ID…");
      let orderId = bridgeOrder.orderId;
      if (!orderId) {
        // Poll for order ID — it takes a few seconds for deBridge to index the tx
        for (let i = 0; i < 12; i++) {
          try {
            orderId = await getOrderIdByTxHash(txHash);
            break;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
      if (!orderId) {
        throw new Error("Could not find deBridge order ID from transaction hash. Check status at app.debridge.com");
      }

      // Step 3: Wait for bridge completion
      setBridgeStep("waiting");
      setBridgeStatus("Step 3/4: Waiting for bridge to complete (Arbitrum → Solana)…");
      await waitForBridgeCompletion(orderId, {
        pollIntervalMs: 5000,
        timeoutMs: 600_000,
        onProgress: (status) => {
          setBridgeStatus(`Step 3/4: Bridge status: ${status}…`);
        },
      });

      // Step 4: Now we have USDC on the auto-generated Solana wallet.
      // Convert USDC → SOL via Jupiter, then run the leverage engine.
      setBridgeStep("leveraging");
      setBridgeStatus("Step 4/4: USDC received on Solana! Running leverage engine…");

      // Retrieve the stored keypair for signing Solana transactions
      const stored = getStoredSolanaWallet();
      if (!stored) {
        throw new Error("Solana wallet not found. Refresh and try again.");
      }

      // The auto-generated wallet doesn't have a wallet adapter interface,
      // so we create a mock adapter that signs with the stored keypair.
      // generateSolanaWallet() returns the decrypted keypair from localStorage.
      const keypairResult = await generateSolanaWallet();
      const solKeypair = keypairResult.keypair;

      // Create a mock wallet adapter for the auto-generated keypair
      const mockWalletAdapter = {
        signTransaction: async (tx: any) => {
          tx.sign([solKeypair]);
          return tx;
        },
        signAllTransactions: async (txs: any[]) => {
          for (const tx of txs) tx.sign([solKeypair]);
          return txs;
        },
        publicKey: solKeypair.publicKey,
      };

      // Calculate SOL collateral from bridged USDC
      const currentSolPrice = solPrice ?? (await getSolPrice());
      const collateralSolFromBridge = bridgeUsdcAmount / currentSolPrice;

      // Swap ~$3 of USDC → SOL for gas fees (auto wallet has no SOL)
      setBridgeStatus("Step 4/4: Swapping USDC → SOL for gas…");
      const gasUsdcRaw = usdcToRaw(3); // $3 USDC for gas
      try {
        const gasQuote = await getJupiterQuote({
          inputMint: USDC_MINT,
          outputMint: SOL_MINT,
          amount: gasUsdcRaw,
          slippageBps: 300, // 3% slippage for gas swap
        });
        const gasSwapTx = await getJupiterSwapTx(gasQuote, autoSolWallet, 300);
        await signAndSendTransaction(gasSwapTx, mockWalletAdapter, connection);
      } catch (gasErr: any) {
        // Gas swap might fail if insufficient USDC — continue anyway, maybe wallet has some SOL
        console.warn("Gas swap failed:", gasErr?.message);
      }

      // Run the borrow leverage engine
      const leverageResult = await openBorrowLeveragePosition({
        walletAddress: autoSolWallet,
        walletAdapter: mockWalletAdapter,
        connection,
        collateralSol: collateralSolFromBridge,
        leverage,
        targetMint: selectedToken.mint,
        slippagePercent: slippage,
        solPrice: currentSolPrice,
      });

      setResult(leverageResult);
      setBridgeStep("done");
      setBridgeStatus("✅ Bridge + leverage complete!");
    } catch (e: any) {
      setBridgeError(e?.message ?? String(e));
      setBridgeStep("idle");
    }
  }, [selectedToken, evmAddress, autoSolWallet, bridgeUsdcAmount, leverage, slippage, solPrice, connection]);

  // ─── Direct Solana leverage execution (existing flow) ───────────────
  const handleExecute = useCallback(async () => {
    if (!selectedToken) return;
    if (!connected || !publicKey || !wallet) {
      setError("Connect your Solana wallet first (Phantom or Solflare).");
      return;
    }
    if (collateralSol <= 0) {
      setError("Enter a valid SOL collateral amount.");
      return;
    }

    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const res = await openBorrowLeveragePosition({
        walletAddress: publicKey.toBase58(),
        walletAdapter: wallet.adapter,
        connection,
        collateralSol,
        leverage,
        targetMint: selectedToken.mint,
        slippagePercent: slippage,
        solPrice: solPrice ?? undefined,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      if (e?.steps) setResult({ signatures: e.signatures ?? [], steps: e.steps, provider: "kamino" });
    } finally {
      setExecuting(false);
    }
  }, [selectedToken, connected, publicKey, wallet, connection, collateralSol, leverage, slippage, solPrice]);

  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  const fmtNum = (n: number, d = 4) => n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(d);

  return (
    <div>
      <h2 className="text-lg font-black mb-1">🌀 Spot Leverage</h2>
      <p className="text-xs text-muted mb-4">
        Long any memecoin with leverage on Solana. SOL collateral → borrow USDC → swap to target.
      </p>

      {/* ── Token Search ── */}
      {!selectedToken ? (
        <div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memecoin (e.g. BONK, WIF, MEME)..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono mb-3 focus:outline-none focus:border-purple-500/50 placeholder:text-muted/50"
            autoFocus
          />

          {searching && (
            <div className="text-xs text-muted text-center py-4">Searching...</div>
          )}

          {!searching && results.length > 0 && (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {results.map((token) => (
                <button
                  key={token.mint}
                  onClick={() => setSelectedToken(token)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:border-purple-500/30 hover:bg-purple-500/5 transition-all text-left"
                >
                  {token.logoUri ? (
                    <img src={token.logoUri} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                      {token.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{token.symbol}</div>
                    <div className="text-[10px] text-muted truncate">{token.name}</div>
                  </div>
                  <div className="text-right">
                    {token.priceUsd != null && (
                      <div className="text-xs font-mono">${fmtNum(token.priceUsd)}</div>
                    )}
                    {token.volume24h != null && token.volume24h > 0 && (
                      <div className="text-[10px] text-muted">
                        Vol ${(token.volume24h / 1000).toFixed(0)}k
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searching && query && results.length === 0 && (
            <div className="text-xs text-muted text-center py-4">No tokens found. Try a different search.</div>
          )}

          {!query && (
            <div className="text-xs text-muted text-center py-8">
              Type a token name or symbol to search Solana memecoins
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Back button */}
          <button
            onClick={() => setSelectedToken(null)}
            className="text-xs text-muted hover:text-white mb-3 flex items-center gap-1"
          >
            ← Back to search
          </button>

          {/* ── Token Info ── */}
          <div className="flex items-center gap-3 mb-4">
            {selectedToken.logoUri ? (
              <img src={selectedToken.logoUri} alt="" className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-400">
                {selectedToken.symbol.slice(0, 2)}
              </div>
            )}
            <div className="flex-1">
              <div className="font-black text-lg">{selectedToken.symbol}</div>
              <div className="text-xs text-muted">{selectedToken.name}</div>
            </div>
            {selectedToken.priceUsd != null && (
              <div className="text-right">
                <div className="text-sm font-mono">${fmtNum(selectedToken.priceUsd)}</div>
                {selectedToken.volume24h != null && selectedToken.volume24h > 0 && (
                  <div className="text-[10px] text-muted">
                    24h Vol ${(selectedToken.volume24h / 1000).toFixed(0)}k
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mint info */}
          <div className="bg-white/[0.03] rounded-xl p-3 mb-3 text-xs text-muted space-y-1">
            <div>Mint: <span className="font-mono text-white text-[10px]">{selectedToken.mint}</span></div>
            {selectedToken.liquidity != null && selectedToken.liquidity > 0 && (
              <div>Liquidity: <span className="font-mono text-white">${(selectedToken.liquidity / 1000).toFixed(0)}k</span></div>
            )}
          </div>

          {/* ── Leverage Form ── */}
          <div className="space-y-4">

            {/* ── Cross-Chain Bridge Banner (EVM-only users) ── */}
            {isEvmOnly && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🌉</span>
                  <div>
                    <div className="text-sm font-bold text-blue-400">Cross-Chain Bridge</div>
                    <div className="text-[11px] text-muted">
                      You need SOL on Solana for leverage. Bridge USDC from Arbitrum → Solana.
                    </div>
                  </div>
                </div>

                {/* Auto-generated Solana wallet */}
                {autoSolWallet ? (
                  <div className="bg-white/[0.03] rounded-lg p-2.5 space-y-1">
                    <div className="text-[10px] text-muted uppercase tracking-wider">Auto-Generated Solana Wallet</div>
                    <div className="font-mono text-[11px] text-white truncate">{autoSolWallet}</div>
                    <div className="text-[10px] text-muted">
                      ⚠ This wallet is stored encrypted in your browser. No Phantom/Solflare needed.
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted">Generating Solana wallet…</div>
                )}

                {/* USDC amount to bridge */}
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1.5 block">
                    USDC to Bridge (Arbitrum → Solana)
                  </label>
                  <input
                    type="number"
                    value={bridgeUsdcAmount}
                    onChange={(e) => setBridgeUsdcAmount(Math.max(1, parseFloat(e.target.value) || 0))}
                    step={1}
                    min={1}
                    placeholder="50"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                  />
                  {solPrice && bridgeUsdcAmount > 0 && (
                    <div className="text-[10px] text-muted mt-1">
                      ≈ {(bridgeUsdcAmount / solPrice).toFixed(3)} SOL at current price
                    </div>
                  )}
                </div>

                {/* Bridge + Leverage button */}
                <button
                  onClick={handleBridgeAndLeverage}
                  disabled={
                    bridgeStep !== "idle" && bridgeStep !== "done" ||
                    bridgeUsdcAmount <= 0 ||
                    !autoSolWallet
                  }
                  className={`w-full py-3 rounded-xl text-sm font-black transition-all ${
                    bridgeStep !== "idle" && bridgeStep !== "done"
                      ? "bg-blue-500/30 text-blue-300 cursor-wait"
                      : "bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 hover:border-blue-500/60"
                  }`}
                >
                  {bridgeStep === "idle" && `🌉 Bridge & Open ${leverage}x Long`}
                  {bridgeStep === "approving" && "🔄 Approving USDC…"}
                  {bridgeStep === "bridging" && "🔄 Sign Bridge Tx…"}
                  {bridgeStep === "waiting" && "⏳ Waiting for Bridge…"}
                  {bridgeStep === "leveraging" && "⚡ Running Leverage Engine…"}
                  {bridgeStep === "done" && "✅ Done! Open another?"}
                </button>

                {/* Bridge progress */}
                {bridgeStatus && bridgeStep !== "idle" && (
                  <div className="bg-white/[0.03] rounded-lg p-2.5 text-xs text-blue-300 font-mono">
                    {bridgeStatus}
                  </div>
                )}

                {/* Bridge steps progress indicator */}
                {bridgeStep !== "idle" && bridgeStep !== "done" && (
                  <div className="space-y-1.5">
                    <BridgeProgressStep label="Approve USDC" step="approving" current={bridgeStep} />
                    <BridgeProgressStep label="Bridge Arbitrum → Solana" step="bridging" current={bridgeStep} />
                    <BridgeProgressStep label="Wait for Bridge" step="waiting" current={bridgeStep} />
                    <BridgeProgressStep label="Leverage Engine" step="leveraging" current={bridgeStep} />
                  </div>
                )}

                {/* Bridge error */}
                {bridgeError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-xs text-red-400">
                    <div className="font-bold mb-0.5">❌ Bridge Error</div>
                    <div className="font-mono text-[11px] whitespace-pre-wrap">{bridgeError}</div>
                  </div>
                )}

                {/* Step explanation */}
                <div className="text-[10px] text-muted space-y-0.5">
                  <div>1. Sign EVM tx to bridge USDC from Arbitrum to Solana</div>
                  <div>2. Wait for deBridge to complete (~1-3 min)</div>
                  <div>3. Swap bridged USDC → SOL on Solana (Jupiter)</div>
                  <div>4. Run Kamino leverage: borrow USDC → swap to {selectedToken.symbol}</div>
                </div>
              </div>
            )}

            {/* ── SOL Collateral Input (only for Solana-connected users) ── */}
            {isSolanaConnected && (
              <div>
                <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1.5 block">
                  SOL Collateral
                </label>
                <input
                  type="number"
                  value={collateralSol}
                  onChange={(e) => setCollateralSol(Math.max(0, parseFloat(e.target.value) || 0))}
                  step={0.1}
                  min={0}
                  placeholder="0.5"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-purple-500/50"
                />
                {solPrice && collateralSol > 0 && (
                  <div className="text-[10px] text-muted mt-1">
                    ≈ {fmtUsd(collateralSol * solPrice)}
                  </div>
                )}
              </div>
            )}

            {/* Leverage Slider */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">
                  Leverage
                </label>
                <span className={`text-sm font-black ${leverage >= 7 ? 'text-red-400' : leverage >= 5 ? 'text-orange-400' : 'text-purple-400'}`}>
                  {leverage}x
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={10}
                step={0.5}
                value={leverage}
                onChange={(e) => setLeverage(parseFloat(e.target.value))}
                className="w-full accent-purple-500"
              />
              <div className="flex justify-between text-[10px] text-muted mt-0.5">
                <span>2x</span>
                <span>5x</span>
                <span>10x</span>
              </div>
            </div>

            {/* ── Estimates ── */}
            {estimate && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-muted uppercase tracking-wider mb-1">Position Estimate</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted text-[10px]">Position Size</div>
                    <div className="font-mono font-bold text-white">{fmtUsd(estimate.positionSizeUsd)}</div>
                  </div>
                  <div>
                    <div className="text-muted text-[10px]">Borrow Amount</div>
                    <div className="font-mono font-bold text-orange-400">{fmtUsd(estimate.borrowUsd)}</div>
                  </div>
                  <div>
                    <div className="text-muted text-[10px]">Collateral Value</div>
                    <div className="font-mono font-bold text-green-400">{fmtUsd(estimate.collateralUsd)}</div>
                  </div>
                  <div>
                    <div className="text-muted text-[10px]">Liquidation Drop</div>
                    <div className={`font-mono font-bold ${estimate.liquidationDropPct <= 20 ? 'text-red-400' : 'text-yellow-400'}`}>
                      -{estimate.liquidationDropPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
                {estimate.estimatedTokens > 0 && selectedToken.priceUsd && (
                  <div className="pt-1 border-t border-white/5">
                    <div className="text-muted text-[10px]">Est. Tokens Received</div>
                    <div className="font-mono font-bold text-purple-400 text-sm">
                      {fmtNum(estimate.estimatedTokens)} {selectedToken.symbol}
                    </div>
                  </div>
                )}
                <div className="pt-1 border-t border-white/5 text-[10px] text-muted">
                  ⚠ Liquidation if SOL drops {estimate.liquidationDropPct.toFixed(1)}% from entry
                </div>
              </div>
            )}

            {/* Advanced: Slippage */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[10px] text-muted hover:text-white"
              >
                {showAdvanced ? "▼" : "▶"} Advanced
              </button>
              {showAdvanced && (
                <div className="mt-2">
                  <label className="text-xs text-muted">Slippage ({slippage}%)</label>
                  <input
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={slippage}
                    onChange={(e) => setSlippage(parseFloat(e.target.value))}
                    className="w-full accent-purple-500 mt-1"
                  />
                </div>
              )}
            </div>

            {/* ── Wallet Connection Warning ── */}
            {!connected && !evmConnected && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 text-xs text-yellow-400">
                ⚠ Connect a wallet to execute. Use EVM (MetaMask/Rainbow) for cross-chain, or Solana (Phantom) for direct leverage.
              </div>
            )}
            {evmConnected && !connected && autoSolWallet && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 text-xs text-blue-400">
                ✅ EVM wallet connected. Solana wallet auto-generated for cross-chain bridging.
              </div>
            )}

            {/* ── Execute Button (Solana-connected users only) ── */}
            {isSolanaConnected && (
              <button
                onClick={handleExecute}
                disabled={executing || !connected || collateralSol <= 0}
                className={`w-full py-3 rounded-xl text-sm font-black transition-all ${
                  executing
                    ? "bg-purple-500/30 text-purple-300 cursor-wait"
                    : connected && collateralSol > 0
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 hover:border-purple-500/60"
                    : "bg-white/5 text-muted border border-white/5 cursor-not-allowed"
                }`}
              >
                {executing ? "Executing…" : connected ? `Open ${leverage}x Long` : "Connect Wallet to Continue"}
              </button>
            )}

            {/* ── Step Progress ── */}
            {executing && (
              <div className="space-y-1.5">
                <ProgressStep label="Setup — Create Kamino obligation" step={0} steps={result?.steps} />
                <ProgressStep label="Borrow — Open leveraged position" step={1} steps={result?.steps} />
                <ProgressStep label="Swap — USDC → target token" step={2} steps={result?.steps} />
              </div>
            )}

            {/* ── Result Steps ── */}
            {result && !executing && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 space-y-1.5">
                <div className="text-xs font-bold text-green-400 mb-1">📋 Transaction Steps</div>
                {result.steps.map((step, i) => (
                  <div key={i} className="text-xs font-mono text-muted flex gap-2">
                    <span className="text-muted/50">{i + 1}.</span>
                    <span className={step.startsWith("✅") ? "text-green-400" : step.startsWith("⚠") ? "text-yellow-400" : "text-muted"}>
                      {step}
                    </span>
                  </div>
                ))}
                {result.signatures.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    {result.signatures.map((sig, i) => (
                      <a
                        key={i}
                        href={`https://solscan.io/tx/${sig}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[10px] font-mono text-blue-400 hover:text-blue-300 truncate"
                      >
                        🔗 {sig}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Error ── */}
            {error && !executing && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400">
                <div className="font-bold mb-1">❌ Error</div>
                <div className="font-mono text-[11px] whitespace-pre-wrap">{error}</div>
              </div>
            )}

            {/* ── Your Kamino Positions ── */}
            {connected && obligations.length > 0 && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  📊 Your Leverage Positions
                  <span className="text-[10px] text-muted font-normal">({obligations.length})</span>
                </div>
                {obligations.map((obs, i) => (
                  <div key={i} className="bg-white/[0.02] rounded-lg p-2.5 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted">Collateral</span>
                      <span className="font-mono text-green-400">${obs.collateralValueUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted">Borrowed</span>
                      <span className="font-mono text-red-400">${obs.borrowedValueUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted">Health Factor</span>
                      <span className={`font-mono ${obs.healthFactor > 2 ? "text-green-400" : obs.healthFactor > 1.2 ? "text-yellow-400" : "text-red-400"}`}>
                        {obs.healthFactor.toFixed(2)}
                      </span>
                    </div>
                    {obs.deposits.map((d, j) => (
                      <div key={j} className="flex justify-between text-[10px] text-muted">
                        <span>Deposit #{j + 1}</span>
                        <span className="font-mono truncate max-w-[200px]">{d.depositReserve.slice(0, 8)}…</span>
                      </div>
                    ))}
                    <a
                      href={`https://kamino.com/borrow/obligation/${obs.obligationAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[10px] text-blue-400 hover:text-blue-300 pt-1"
                    >
                      View on Kamino ↗
                    </a>
                  </div>
                ))}
              </div>
            )}

            {/* ── How It Works ── */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <div className="text-xs font-bold text-purple-400 mb-1">How Custom Leverage Works</div>
              {isEvmOnly ? (
                <div className="text-xs text-muted space-y-1">
                  <div>1. <span className="text-white">Bridge</span> — deBridge sends USDC from Arbitrum to your auto-generated Solana wallet</div>
                  <div>2. <span className="text-white">Swap</span> — Jupiter swaps bridged USDC → SOL (collateral)</div>
                  <div>3. <span className="text-white">Borrow</span> — Kamino borrows USDC against SOL with leverage</div>
                  <div>4. <span className="text-white">Swap</span> — Jupiter swaps borrowed USDC → {selectedToken.symbol}</div>
                  <div className="pt-1 text-yellow-400/80">⚠ Your SOL collateral is at risk if liquidated. Manage risk carefully.</div>
                </div>
              ) : (
                <div className="text-xs text-muted space-y-1">
                  <div>1. <span className="text-white">Setup</span> — Create Kamino obligation (SOL collateral, USDC debt)</div>
                  <div>2. <span className="text-white">Borrow</span> — Kamino opens leveraged position, borrows USDC against SOL</div>
                  <div>3. <span className="text-white">Swap</span> — Jupiter swaps borrowed USDC → {selectedToken.symbol}</div>
                  <div className="pt-1 text-yellow-400/80">⚠ Your SOL collateral is at risk if liquidated. Manage risk carefully.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step Progress Indicators ─────────────────────────────────────────────

function ProgressStep({
  label,
  step,
  steps,
}: {
  label: string;
  step: number;
  steps?: string[];
}) {
  const doneCount = steps?.filter(s => s.startsWith("✅") || s.startsWith("ℹ") || s.startsWith("⚠")).length ?? 0;
  const isDone = step < doneCount;
  const isInProgress = step === doneCount;
  const isPending = step > doneCount;

  return (
    <div className={`flex items-center gap-2 text-xs ${isDone ? "text-green-400" : isInProgress ? "text-purple-400" : "text-muted/50"}`}>
      <div className={`
        w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0
        ${isDone ? "bg-green-500/20" : isInProgress ? "bg-purple-500/20 animate-pulse" : "bg-white/5"}
      `}>
        {isDone ? "✓" : step + 1}
      </div>
      <span>{label}</span>
    </div>
  );
}

function BridgeProgressStep({
  label,
  step,
  current,
}: {
  label: string;
  step: string;
  current: string;
}) {
  const stepOrder = ["approving", "bridging", "waiting", "leveraging", "done"];
  const currentIdx = stepOrder.indexOf(current);
  const stepIdx = stepOrder.indexOf(step);
  const isDone = stepIdx < currentIdx;
  const isInProgress = step === current;
  const isPending = stepIdx > currentIdx;

  return (
    <div
      className={`flex items-center gap-2 text-xs ${
        isDone ? "text-green-400" : isInProgress ? "text-blue-400" : "text-muted/50"
      }`}
    >
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
          isDone
            ? "bg-green-500/20"
            : isInProgress
            ? "bg-blue-500/20 animate-pulse"
            : "bg-white/5"
        }`}
      >
        {isDone ? "✓" : stepIdx + 1}
      </div>
      <span>{label}</span>
    </div>
  );
}