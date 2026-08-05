# Lever NFT Utility Design

## Overview
10k generative PFP collection that provides real utility to Lever traders.

## Tiers

### 🥉 Iron Levers (6,000 NFTs — 60%)
- **Mint price:** Free (gas only) — community onboarding
- **Trading fee discount:** 10% off maker fees (via rebate contract)
- **Access:** Iron-only trading channel + alpha chat
- **Early access:** New coin listings 1 hour before public
- **Governance:** 1 vote per NFT on coin listing proposals

### 🥈 Silver Levers (3,000 NFTs — 30%)
- **Mint price:** 0.05 ETH
- **Trading fee discount:** 25% off maker fees
- **Funding rate boost:** +5% funding rate rebate (short more profitably, long gets some back)
- **Access:** Silver trading channel + alpha chat + analytics dashboard
- **Early access:** New coin listings 4 hours before public
- **Priority:** Order book priority in congestion (notional priority)
- **Governance:** 3 votes per NFT

### 🥇 Gold Levers (900 NFTs — 9%)
- **Mint price:** 0.2 ETH
- **Trading fee discount:** 50% off maker fees
- **Funding rate boost:** +15% funding rate rebate
- **Access:** Gold channel + 1-on-1 with team + private signals
- **Early access:** New coin listings 24 hours before public
- **Revenue share:** 10% of platform trading fees distributed to Gold holders
- **Governance:** 10 votes per NFT

### 💎 Diamond Levers (100 NFTs — 1%)
- **Mint price:** 1 ETH (whitelist only)
- **Trading fee discount:** 100% off maker fees
- **Funding rate boost:** +25% funding rate rebate
- **Access:** Everything + direct team line
- **Early access:** New coin listings 48 hours before public
- **Revenue share:** 25% of platform trading fees (pro-rata among Diamond holders)
- **Governance:** 50 votes per NFT + veto power on listings
- **Custom:** Diamond holder gets custom PFP trait guaranteed

## Revenue Mechanics

### Fee Distribution (from platform trading revenue)
- 40% → Platform treasury (operations, dev, marketing)
- 30% → Revenue share pool (Gold + Diamond holders)
- 20% → Buy-back & burn mechanism for LEVER token
- 10% → Community fund (grants, events, liquidity incentives)

### Funding Rate Rebate
When an NFT holder has an open position, the funding rate rebate applies:
- If funding is positive (longs pay shorts): NFT holder gets X% back as rebate
- If funding is negative (shorts pay longs): NFT holder pays X% less
- Rebate is paid daily in USDC to the holder's wallet

## Rarity & Generation
- Algorithm: Hash-based generative from on-chain seed
- Traits: Background, Body, Weapon (lever type), Eyes, Hat, Expression
- Rarity tiers within each tier: Common (70%), Uncommon (20%), Rare (8%), Legendary (2%)
- Legendary traits stack with tier benefits

## Staking
- Staking NFT in the Lever protocol = 1.5x benefits multiplier
- Staked NFTs can't be sold (unstake 48h cooldown)
- Staking earns additional LEVER token emissions

## Anti-Speculation
- Mint limits: 1 per wallet for Gold/Diamond, 3 for Silver, 5 for Iron
- Holding period: 7 days before transferable
- Benefit verification: NFT must be in holding wallet to activate benefits

## Implementation Priority
1. NFT smart contract (ERC-721 with tier logic)
2. Benefits registry contract (maps NFT tier → fee rates)
3. Fee rebate distribution contract
4. Frontend: NFT benefits display in Lever UI
5. Revenue share calculator on dashboard