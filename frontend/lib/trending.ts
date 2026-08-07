"use client";

import { useEffect, useState } from "react";

export type TrendingToken = {
  symbol: string;
  chain: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  logoUri?: string;
  address: string;
};

export async function fetchDexScreenerTrending(): Promise<TrendingToken[]> {
  try {
    // 1. Get trending token profiles from DexScreener
    const profileRes = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
    const profiles = await profileRes.json();

    // Filter to solana + arbitrum + base meme tokens
    const memeChains = ["solana", "arbitrum", "base", "bsc"];
    const filtered = profiles.filter((p: any) => memeChains.includes(p.chainId));

    // Deduplicate by tokenAddress, limit to top 20
    const seen = new Set<string>();
    const unique = filtered.filter((p: any) => {
      const key = `${p.chainId}-${p.tokenAddress}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);

    if (unique.length === 0) return [];

    // 2. Fetch pair data for each token (batch by addresses)
    const tokens: TrendingToken[] = [];

    // Process in small batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (p: any) => {
          const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${p.tokenAddress}`);
          const data = await res.json();
          const pairs = data.pairs || [];
          // Pick the pair with highest volume on the token's chain
          const onChain = pairs
            .filter((pair: any) => pair.chainId === p.chainId)
            .sort((a: any, b: any) =>
              (parseFloat(b.volume?.h24 || "0")) - (parseFloat(a.volume?.h24 || "0"))
            );
          const best = onChain[0];
          if (!best) return null;
          return {
            symbol: best.baseToken?.symbol || "?",
            chain: best.chainId,
            price: parseFloat(best.priceUsd || "0"),
            change24h: best.priceChange?.h24 != null ? parseFloat(best.priceChange.h24) : null,
            volume24h: best.volume?.h24 != null ? parseFloat(best.volume.h24) : null,
            logoUri: p.icon || best.info?.imageUrl,
            address: p.tokenAddress,
          } as TrendingToken;
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) tokens.push(r.value);
      }
    }

    // Sort by volume descending, take top 5
    tokens.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    return tokens.slice(0, 5);
  } catch (err) {
    console.error("DexScreener trending fetch failed:", err);
    return [];
  }
}

export async function fetchPumpFunTrending(): Promise<TrendingToken[]> {
  try {
    const res = await fetch("https://frontend-api.pump.fun/emerging-coin-list?offset=0&limit=5", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map((t: any) => ({
      symbol: t.symbol || t.name?.slice(0, 6) || "?",
      chain: "solana",
      price: parseFloat(t.usd_market_cap || "0") > 0
        ? parseFloat(t.usd_market_cap) / (parseFloat(t.total_supply || "1"))
        : 0,
      change24h: null,
      volume24h: parseFloat(t.usd_volume_24h || "0") || null,
      logoUri: t.image_uri || t.icon_uri,
      address: t.mint,
    }));
  } catch {
    return [];
  }
}