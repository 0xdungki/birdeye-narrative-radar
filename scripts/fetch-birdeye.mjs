import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

async function loadEnv() {
  try {
    const txt = await fs.readFile(path.join(root, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const narratives = [
  { id: 'ai', label: 'AI / Agents', terms: ['ai', 'agent', 'gpt', 'llm', 'bot', 'agi', 'compute', 'neural', 'mind', 'clanker'] },
  { id: 'cult', label: 'Internet cult / Meme culture', terms: ['meme', 'troll', 'wojak', 'chud', 'neet', 'bull', 'bear', 'mascot', 'king', 'queen', 'crown', 'pnut', 'goat', 'based'] },
  { id: 'cat', label: 'Cat memes', terms: ['cat', 'kitty', 'kitten', 'meow', 'mew', 'popcat', 'michi', 'miau', 'neko'] },
  { id: 'dog', label: 'Dog memes', terms: ['dog', 'doge', 'shib', 'inu', 'pup', 'bonk', 'wif', 'floki'] },
  { id: 'frog', label: 'Frog / Pepe memes', terms: ['frog', 'pepe', 'brett', 'kermit'] },
  { id: 'politics', label: 'Politics / Celeb meta', terms: ['trump', 'maga', 'biden', 'elon', 'ye', 'putin', 'president', 'america', 'usa'] },
  { id: 'defi', label: 'DeFi / Yield', terms: ['swap', 'dex', 'defi', 'yield', 'stake', 'lend', 'vault', 'dao', 'pump'] },
  { id: 'infra', label: 'Infra / DePIN', terms: ['depin', 'cloud', 'data', 'node', 'chain', 'sol', 'base', 'network', 'oracle'] },
  { id: 'gaming', label: 'Gaming / Metaverse', terms: ['game', 'play', 'pixel', 'quest', 'arena', 'rpg', 'verse'] },
  { id: 'rwa', label: 'RWA / Finance', terms: ['rwa', 'real', 'estate', 'gold', 'usd', 'bond', 'stock', 'treasury'] },
  { id: 'bluechip', label: 'Bluechip / Majors', terms: ['solana', 'sol', 'bitcoin', 'btc', 'ethereum', 'eth', 'jupiter', 'raydium', 'pyth'] },
];

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function classify(token) {
  const text = `${token.symbol || ''} ${token.name || ''}`.toLowerCase();
  const hits = [];
  for (const n of narratives) {
    const matched = n.terms.filter(t => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text));
    if (matched.length) hits.push({ ...n, matched });
  }
  if (!hits.length) return [{ id: 'other', label: 'Other / Unclassified', matched: [] }];
  return hits;
}

function summarize(tokens) {
  const buckets = new Map();
  for (const t of tokens) {
    const priceChange24h = asNum(pick(t, ['price24hChangePercent', 'priceChange24hPercent', 'priceChange24h', 'price_change_24h_percent', 'price_change_24h']));
    const volume24h = asNum(pick(t, ['volume24hUSD', 'v24hUSD', 'volume24h', 'volume_24h_usd', 'volume']));
    const liquidity = asNum(pick(t, ['liquidity', 'liquidityUSD', 'liquidity_usd']));
    const fdv = asNum(pick(t, ['fdv', 'marketcap', 'mc', 'marketCap']));
    const enriched = {
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      logoURI: t.logoURI,
      rank: asNum(t.rank || t.trendingRank),
      price: asNum(t.price),
      priceChange24h,
      volume24h,
      liquidity,
      fdv,
    };
    for (const n of classify(t)) {
      if (!buckets.has(n.id)) buckets.set(n.id, { id: n.id, label: n.label, tokens: [], matchedTerms: new Set(), count: 0, avgChange24h: 0, totalVolume24h: 0, totalLiquidity: 0, medianFdv: 0, score: 0 });
      const b = buckets.get(n.id);
      b.tokens.push({ ...enriched, matched: n.matched });
      n.matched.forEach(x => b.matchedTerms.add(x));
    }
  }

  const rows = [...buckets.values()].map(b => {
    b.count = b.tokens.length;
    b.avgChange24h = b.tokens.reduce((s, t) => s + t.priceChange24h, 0) / Math.max(1, b.count);
    b.totalVolume24h = b.tokens.reduce((s, t) => s + t.volume24h, 0);
    b.totalLiquidity = b.tokens.reduce((s, t) => s + t.liquidity, 0);
    const fdvs = b.tokens.map(t => t.fdv).filter(Boolean).sort((a, z) => a - z);
    b.medianFdv = fdvs.length ? fdvs[Math.floor(fdvs.length / 2)] : 0;
    const countWeight = b.id === 'other' ? 6 : 20;
    const momentumCap = b.id === 'other' ? 20 : 50;
    b.score = Math.round((b.count * countWeight) + Math.min(momentumCap, Math.max(-20, b.avgChange24h)) + Math.log10(1 + b.totalVolume24h) * 7 + Math.log10(1 + b.totalLiquidity) * 5);
    b.matchedTerms = [...b.matchedTerms].sort();
    b.tokens.sort((a, z) => (z.volume24h + z.liquidity / 10 + z.priceChange24h * 1000) - (a.volume24h + a.liquidity / 10 + a.priceChange24h * 1000));
    return b;
  }).sort((a, z) => z.score - a.score);

  return rows;
}

async function main() {
  await loadEnv();
  const key = process.env.BIRDEYE_API_KEY;
  const chain = process.env.BIRDEYE_CHAIN || 'solana';
  const limit = Math.min(20, Math.max(10, Number(process.env.BIRDEYE_LIMIT || 20)));
  if (!key) throw new Error('Missing BIRDEYE_API_KEY in .env');

  const url = new URL('https://public-api.birdeye.so/defi/token_trending');
  url.searchParams.set('sort_by', 'rank');
  url.searchParams.set('sort_type', 'asc');
  url.searchParams.set('offset', '0');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, { headers: { 'X-API-KEY': key, 'x-chain': chain, accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Birdeye ${res.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body);
  const tokens = json?.data?.tokens || json?.data?.items || [];
  const rotations = summarize(tokens);
  const output = {
    generatedAt: new Date().toISOString(),
    chain,
    source: 'Birdeye token_trending',
    tokenCount: tokens.length,
    topNarrative: rotations.find(r => r.id !== 'other')?.label || rotations[0]?.label || 'N/A',
    rotations,
  };
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'latest.json'), JSON.stringify(output, null, 2));
  await fs.mkdir(path.join(root, 'public', 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'public', 'data', 'latest.json'), JSON.stringify(output, null, 2));
  console.log(`OK: ${tokens.length} tokens -> ${rotations.length} narratives. Top: ${output.topNarrative}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
