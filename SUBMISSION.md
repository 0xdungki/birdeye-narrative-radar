# Birdeye Sprint Submission Draft

## Project name
Birdeye Narrative Rotation Radar

## One-liner
A Birdeye-powered Solana dashboard that detects which crypto narratives are rotating fastest, not just which individual token is trending.

## Description
Narrative Rotation Radar uses Birdeye trending token data to classify tokens into market narratives like AI agents, meme culture, cat/dog/frog memes, politics, DeFi, infra/DePIN, gaming, RWA, and majors. It scores each narrative by momentum, 24h volume, liquidity, token count, and FDV, then tracks the leaderboard over time with SQLite history and dashboard spark bars.

The goal is to turn raw trending-token feeds into higher-level market intelligence: traders and researchers can see when a new meta starts forming before a single obvious token dominates.

## Birdeye usage
- `GET /defi/token_trending` on Solana
- token metadata: symbol/name/logo
- market metrics: price, 24h price change, 24h volume, liquidity, FDV/market cap

## Key features
- Narrative clustering from Birdeye token metadata
- Rotation scoring and leaderboard
- Historical snapshots with SQLite
- Static web dashboard with clickable token cards, chart/detail panel, copyable CA, Dexscreener/Birdeye links, search/filter controls, risk badges, top movers, watchlist, shareable token URLs, and JSON/CSV export
- Optional silent-unless-actionable alert script
- Read-only; no wallet, no swaps, no private keys

## Demo instructions
```bash
cp .env.example .env
# add BIRDEYE_API_KEY
npm run fetch
npm run serve
# open http://localhost:4173
```

## Repository
https://github.com/0xdungki/birdeye-narrative-radar

## Live demo
https://0xdungki.github.io/birdeye-narrative-radar/
