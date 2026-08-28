// GeckoTerminal's public API is free, keyless, and documented at
// https://apiguide.geckoterminal.com — used here instead of pump.fun's own
// API since pump.fun doesn't expose a public "top gainers" endpoint.

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

/**
 * Trending Solana pools, filtered to ones trading on a pump.fun-family dex
 * (their bonding-curve AMM or the post-graduation PumpSwap pool), sorted by
 * 24h price change descending. Falls back to top-volume pools if nothing
 * pump.fun-flagged shows up in the trending set.
 */
export async function getPumpFunGainers(limit = 10): Promise<TrendingToken[]> {
  const parse = (pool: any): TrendingToken | null => {
    const attrs = pool?.attributes;
    if (!attrs) return null;
    const [baseAddr] = (attrs.address ?? "").split("_"); // pool address itself, not the base token
    const name: string = attrs.name ?? "";
    const symbol = name.split("/")[0]?.trim() || "???";
    return {
      mint: attrs.base_token_address ?? "",
      symbol,
      name: name || symbol,
      priceUsd: parseFloat(attrs.base_token_price_usd ?? "0") || 0,
      priceChange24h: parseFloat(attrs.price_change_percentage?.h24 ?? "0") || 0,
      volume24h: parseFloat(attrs.volume_usd?.h24 ?? "0") || 0,
      marketCap: parseFloat(attrs.market_cap_usd ?? attrs.fdv_usd ?? "0") || 0,
      poolAddress: attrs.address ?? baseAddr ?? "",
    };
  };

  const isPumpDex = (pool: any, included: any[]): boolean => {
    const dexId = pool?.relationships?.dex?.data?.id;
    if (!dexId) return false;
    if (dexId.toLowerCase().includes("pump")) return true;
    const dexEntry = included.find((i) => i.type === "dex" && i.id === dexId);
    return (dexEntry?.attributes?.name ?? "").toLowerCase().includes("pump");
  };

  async function fetchPools(path: string): Promise<TrendingToken[]> {
    // Routed through our own /api/trending proxy — calling
    // api.geckoterminal.com directly from the browser hit the same
    // CORS wall we found with Kamino's API earlier.
    const r = await fetch(`/api/trending?path=${encodeURIComponent(path)}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GeckoTerminal error ${r.status}`);
    const data = await r.json();
    const pools = data.data ?? [];
    const included = data.included ?? [];
    return pools
      .filter((p: any) => isPumpDex(p, included))
      .map(parse)
      .filter((t: TrendingToken | null): t is TrendingToken => !!t && !!t.mint);
  }

  try {
    let tokens = await fetchPools("/networks/solana/trending_pools?include=dex");
    if (tokens.length === 0) {
      // Trending list didn't surface any pump.fun pools right now — fall
      // back to top pools by volume, which reliably include them.
      tokens = await fetchPools("/networks/solana/pools?include=dex&sort=h24_volume_usd_desc");
    }
    return tokens
      .sort((a, b) => b.priceChange24h - a.priceChange24h)
      .slice(0, limit);
  } catch {
    return [];
  }
}
