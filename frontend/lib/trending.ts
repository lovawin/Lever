// GeckoTerminal's public API is free, keyless, and documented at
// https://apiguide.geckoterminal.com — used here instead of pump.fun's own
// API since pump.fun doesn't expose a public "top gainers" endpoint.
//
// GeckoTerminal tracks pump.fun as two separate dexes: "pump-fun" (tokens
// still on the bonding curve) and "pumpswap" (tokens that have graduated to
// a real AMM pool — this is where most volume actually is).

export interface TrendingToken {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  poolAddress: string;
}

const PUMP_DEXES = ["pump-fun", "pumpswap"];

/**
 * Top pump.fun-family pools on Solana, sorted by 24h price change descending.
 */
export async function getPumpFunGainers(limit = 10): Promise<TrendingToken[]> {
  // include=base_token pulls the actual token (mint address, symbol, name)
  // into a separate `included` array — the pool's own `attributes` only
  // has a combined display name like "FOO / SOL", no mint address at all.
  function parse(pool: any, included: any[]): TrendingToken | null {
    const attrs = pool?.attributes;
    if (!attrs) return null;

    const baseTokenId = pool?.relationships?.base_token?.data?.id;
    const baseToken = included.find((i) => i.type === "token" && i.id === baseTokenId);
    const mint: string = baseToken?.attributes?.address ?? "";
    if (!mint) return null;

    const symbol: string = baseToken?.attributes?.symbol || attrs.name?.split("/")[0]?.trim() || "???";
    const name: string = baseToken?.attributes?.name || symbol;

    return {
      mint,
      symbol,
      name,
      priceUsd: parseFloat(attrs.base_token_price_usd ?? "0") || 0,
      priceChange24h: parseFloat(attrs.price_change_percentage?.h24 ?? "0") || 0,
      volume24h: parseFloat(attrs.volume_usd?.h24 ?? "0") || 0,
      marketCap: parseFloat(attrs.fdv_usd ?? attrs.market_cap_usd ?? "0") || 0,
      poolAddress: attrs.address ?? "",
    };
  }

  async function fetchDexPools(dex: string): Promise<TrendingToken[]> {
    // Routed through our own /api/trending proxy — calling
    // api.geckoterminal.com directly from the browser hit the same
    // CORS wall we found with Kamino's API earlier.
    const path = `/networks/solana/dexes/${dex}/pools?include=base_token&sort=h24_volume_usd_desc`;
    const r = await fetch(`/api/trending?path=${encodeURIComponent(path)}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GeckoTerminal error ${r.status}`);
    const data = await r.json();
    const pools = data.data ?? [];
    const included = data.included ?? [];
    return pools
      .map((p: any) => parse(p, included))
      .filter((t: TrendingToken | null): t is TrendingToken => !!t);
  }

  try {
    const results = await Promise.allSettled(PUMP_DEXES.map(fetchDexPools));
    const tokens = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    // Dedupe by mint (a token could theoretically show up via more than one
    // pool) keeping the highest-volume entry for each.
    const byMint = new Map<string, TrendingToken>();
    for (const t of tokens) {
      const existing = byMint.get(t.mint);
      if (!existing || t.volume24h > existing.volume24h) byMint.set(t.mint, t);
    }
    return [...byMint.values()]
      .sort((a, b) => b.priceChange24h - a.priceChange24h)
      .slice(0, limit);
  } catch {
    return [];
  }
}
