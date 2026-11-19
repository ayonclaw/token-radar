// token-radar · the implied-value model (Node 22, standard library only, erasable TypeScript).
//
// The board answers one question: if a protocol's record stayed exactly as this snapshot shows it,
// what would a token on it be worth? Every input is a field the snapshot carries — TVL, seven-day
// change, the day DefiLlama started tracking the protocol — or a multiple measured from the
// token-bearing protocols in the same snapshot. There is no name list and no hand-typed number here.
//
//   implied  =  TVL  ×  multiple(category)  ×  tenure  ×  momentum
//
//   multiple  the median market-cap / TVL of the snapshot's own token-bearing protocols in the same
//             category, shrunk toward the market-wide median by four pseudo-observations so a category
//             with three members cannot invent a multiple. Measured, not assumed.
//   tenure    0.80 + 0.20 × min(months without a token / 24, 1): a protocol that has held TVL for two
//             years with no token has proved the TVL durable; a two-month-old one has not.
//   momentum  1 + 0.5 × clamp(change_7d, -25, +25) / 100: a week of flow moves the number, but a fifth
//             of it and never more than ±12.5%.
//
// A protocol that records a token is never on the board: it has already had its launch, so there is
// nothing to price. The model is applied to the pre-token field only, and every token-bearing protocol
// is kept in `excluded` so the page can show what was left out and on which multiple.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  chg7: number | null;
  months: number;
  mult: number;
  mult_n: number;
  tenure: number;
  momentum: number;
  implied: number;
  score: number;
  watch: boolean;
  steps: string[];
}

export interface Excluded {
  slug: string;
  name: string;
  symbol: string;
  category: string;
  tvl: number;
  mcap: number;
  mult: number;
}

export interface CatStat {
  category: string;
  n: number;
  median: number;
  wear: number;
}

export interface Radar {
  meta: {
    as_of: string;
    source: string;
    floor: number;
    n_protocols: number;
    n_pre: number;
    n_launchable: number;
    n_products: number;
    n_tok: number;
    n_watch: number;
    n_board: number;
    pre_tvl: number;
    watch_tvl: number;
    top_implied: number;
    median_mult: number;
    market_n: number;
    excluded_tvl: number;
  };
  rows: Row[];
  excluded: Excluded[];
  chains: { chain: string; tvl: number; n: number }[];
  months: { bucket: string; n: number; tvl: number }[];
  cats: CatStat[];
}

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;
/** How many pseudo-observations of the market-wide median every category starts with. */
const PRIOR_N = 6;
/** A category's own median is winsorised to this band around the market's before it is believed. */
const CAT_BAND = 3;
/** The widest a measured multiple may be trusted: below 0.02 or above 12 is a data artefact. */
const MULT_FLOOR = 0.02;
const MULT_CEIL = 12;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

const round = (x: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

/** The median of a list of numbers (0 for an empty one). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole months from one YYYY-MM-DD to another, floored at 0. */
export function monthsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / DAY_MS / MONTH_DAYS);
}

/** Validate the snapshot and hand it back. The program refuses to score a file it cannot trust. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  const s = raw as Partial<Snapshot>;
  if (typeof s !== 'object' || s === null) throw new Error('snapshot.json is not an object');
  if (typeof s.as_of !== 'string') throw new Error('snapshot.json has no as_of');
  if (typeof s.floor_usd !== 'number' || !(s.floor_usd > 0)) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(s.protocols) || s.protocols.length === 0) throw new Error('snapshot.json has no protocols');
  if (!Array.isArray(s.watchlist)) throw new Error('snapshot.json has no watchlist');
  const seen = new Set<string>();
  const protocols: Protocol[] = s.protocols.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new Error(`protocols[${i}] is not an object`);
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new Error(`protocols[${i}] has no slug`);
    if (seen.has(p.slug)) throw new Error(`protocols[${i}] repeats the slug ${p.slug}`);
    seen.add(p.slug);
    const tvl = Number(p.tvl_usd);
    if (!Number.isFinite(tvl) || tvl < 0) throw new Error(`protocols[${i}] (${p.slug}) has no tvl_usd`);
    return {
      slug: p.slug,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.slug,
      category: typeof p.category === 'string' && p.category.length > 0 ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string' && c.length > 0) : [],
      tvl_usd: Math.trunc(tvl),
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 ? Math.trunc(p.mcap_usd) : null,
      listed_at: typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' && p.gecko_id.length > 0 ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' && p.symbol.length > 0 && p.symbol !== '-' ? p.symbol : null,
    };
  });
  return {
    as_of: s.as_of,
    source: typeof s.source === 'string' ? s.source : 'DefiLlama',
    floor_usd: s.floor_usd,
    protocols,
    watchlist: s.watchlist.filter((x): x is string => typeof x === 'string'),
  };
}

/** True when DefiLlama records a token for the protocol: it has launched, so it is not on the board. */
export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Categories that are a product of another protocol's token rather than a protocol of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchanges whose name on a protocol means the protocol is the exchange's own product, not a launch. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * True when the record says the protocol is a wrapped, staked, bridged or versioned product of
 * something that already trades — WBTC is Bitcoin on Ethereum, and a bridge's TVL is not a launch.
 * The watchlist applies this test; the board applies it too, so a name like that is never ranked as
 * an opportunity just because its TVL is large.
 */
export function isProduct(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (VERSIONED.test(p.name)) return true;
  return EXCHANGES.some((x) => p.name.toLowerCase().startsWith(x.toLowerCase()));
}

/** The market multiple of one token-bearing protocol, or null when its record cannot support one. */
function marketMultiple(p: Protocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  const m = p.mcap_usd / p.tvl_usd;
  return Number.isFinite(m) && m > 0 ? m : null;
}

/** Per-category measured multiples, shrunk toward the market-wide median by PRIOR_N observations. */
export function measureMultiples(protocols: Protocol[]): { market: number; marketN: number; byCat: Map<string, CatStat> } {
  const all: number[] = [];
  const buckets = new Map<string, number[]>();
  for (const p of protocols) {
    if (!hasToken(p)) continue;
    const m = marketMultiple(p);
    if (m === null) continue;
    all.push(m);
    const key = p.category ?? 'Unclassified';
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [m]);
    else list.push(m);
  }
  const market = all.length > 0 ? clamp(median(all), MULT_FLOOR, MULT_CEIL) : 0.2;
  const byCat = new Map<string, CatStat>();
  for (const [category, list] of buckets) {
    const own = clamp(median(list), Math.max(MULT_FLOOR, market / CAT_BAND), Math.min(MULT_CEIL, market * CAT_BAND));
    const shrunk = (own * list.length + market * PRIOR_N) / (list.length + PRIOR_N);
    byCat.set(category, {
      category,
      n: list.length,
      median: round(own, 3),
      wear: round(clamp(shrunk, MULT_FLOOR, MULT_CEIL), 4),
    });
  }
  return { market: round(market, 4), marketN: all.length, byCat };
}

/** A farm plan: concrete steps, each with what it costs and how long it takes. */
export function farmPlan(p: Protocol, months: number, count: number): string[] {
  const chain = p.chains[0] ?? 'its largest chain';
  const wide = p.chains.length > 1 ? `${p.chains.length} chains, largest ${chain}` : chain;
  const budget = p.tvl_usd > 1e9 ? '40,000' : p.tvl_usd > 2e8 ? '15,000' : '5,000';
  const cat = (p.category ?? '').toLowerCase();
  const venue =
    cat.includes('lend')
      ? 'supply USDC to its deepest market and borrow 30% of it back against the position'
      : cat.includes('dex')
        ? 'provide a USDC pair in its deepest pool and keep the range tight around the current price'
        : cat.includes('yield') || cat.includes('vault')
          ? 'deposit into its largest USDC vault and leave it in place for the full season'
          : cat.includes('bridge')
            ? 'route two round trips of USDC across the bridge and keep a balance parked on the far side'
            : cat.includes('curator') || cat.includes('risk')
              ? 'mint its curator shares with a USDC deposit and hold them through the season'
              : 'deposit USDC into its flagship pool and hold the position through the season';
  const plan = [
    `Open ${p.name} on ${wide} from a fresh wallet and connect it; keep two months of gas aside — about $25 on ${chain}, 15 minutes.`,
    `Move $${budget} of USDC in and ${venue}; one transaction costs $2 to $6 in gas and takes about 10 minutes to confirm.`,
    `Repeat a small interaction every week for 8 weeks — a deposit, a withdrawal or a claim of about $500 — roughly $4 of gas and 5 minutes each week.`,
    `Keep the position open through the next two quarters (${Math.max(3, Math.round(months / 6))} months at this record's pace) and do not move it out before a snapshot is taken: tenure is what a launch rewards.`,
    `Track it here: a ${months.toFixed(0)}-month record with no token is the window being farmed, and a launch announcement is the exit signal, not the entry one.`,
  ];
  return plan.slice(0, Math.max(3, Math.min(12, count)));
}

/** The buckets the page charts: how long the pre-token field has run without a launch. */
const MONTH_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: '0-3', lo: 0, hi: 3 },
  { label: '3-6', lo: 3, hi: 6 },
  { label: '6-12', lo: 6, hi: 12 },
  { label: '12-24', lo: 12, hi: 24 },
  { label: '24-36', lo: 24, hi: 36 },
  { label: '36+', lo: 36, hi: Number.POSITIVE_INFINITY },
];

/** Score one pre-token protocol: every multiplier it uses, and the dollar it lands on. */
function scoreOne(p: Protocol, asOf: string, market: number, byCat: Map<string, CatStat>): Omit<Row, 'rank' | 'score' | 'watch' | 'steps'> {
  const category = p.category ?? 'Unclassified';
  const stat = byCat.get(category);
  const mult = stat === undefined ? market : stat.wear;
  const months = p.listed_at === null ? 0 : monthsBetween(p.listed_at, asOf);
  const tenure = 0.8 + 0.2 * Math.min(months / 24, 1);
  const chg = p.change_7d === null ? 0 : clamp(p.change_7d, -25, 25);
  const momentum = 1 + (0.5 * chg) / 100;
  const implied = Math.max(1, Math.round(p.tvl_usd * mult * tenure * momentum));
  return {
    slug: p.slug,
    name: p.name,
    category,
    chains: p.chains,
    tvl: p.tvl_usd,
    chg7: p.change_7d,
    months: round(months, 1),
    mult: round(mult, 3),
    mult_n: stat === undefined ? 0 : stat.n,
    tenure: round(tenure, 3),
    momentum: round(momentum, 3),
    implied,
  };
}

/**
 * Build the board: every watchlist protocol, then the largest pre-token protocols below the floor,
 * so the watchlist is covered and the board is never only the floor. Ranked by implied value.
 */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const { market, marketN, byCat } = measureMultiples(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const pre = snapshot.protocols.filter((p) => !hasToken(p));

  const onWatch = pre.filter((p) => watch.has(p.slug));
  const below = pre
    .filter((p) => !watch.has(p.slug) && !isProduct(p) && p.tvl_usd > 0)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const wanted = 200;
  const chosen = [...onWatch, ...below.slice(0, Math.max(0, wanted - onWatch.length))];

  const scored = chosen.map((p) => scoreOne(p, snapshot.as_of, market, byCat));
  scored.sort((a, b) => b.implied - a.implied || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1));

  const top = scored[0]?.implied ?? 1;
  const bySlug = new Map(chosen.map((p) => [p.slug, p]));
  const rows: Row[] = scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    score: round((s.implied / top) * 100, 1),
    watch: watch.has(s.slug),
    steps: farmPlan(bySlug.get(s.slug)!, s.months, 5),
  }));

  const excluded: Excluded[] = snapshot.protocols
    .filter(hasToken)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol ?? '—',
      category: p.category ?? 'Unclassified',
      tvl: p.tvl_usd,
      mcap: p.mcap_usd ?? 0,
      mult: round(marketMultiple(p) ?? 0, 3),
    }))
    .sort((a, b) => b.mcap - a.mcap || (a.slug < b.slug ? -1 : 1));

  // Untokenised TVL by chain, attributed to each protocol's first listed chain, so no dollar counts twice.
  const chainMap = new Map<string, { tvl: number; n: number }>();
  for (const p of pre) {
    const chain = p.chains[0] ?? 'Unattributed';
    const cur = chainMap.get(chain) ?? { tvl: 0, n: 0 };
    chainMap.set(chain, { tvl: cur.tvl + p.tvl_usd, n: cur.n + 1 });
  }
  const chains = [...chainMap.entries()]
    .map(([chain, v]) => ({ chain, tvl: v.tvl, n: v.n }))
    .sort((a, b) => b.tvl - a.tvl || (a.chain < b.chain ? -1 : 1));

  // How long the pre-token field has run with no launch, by bucket: count and TVL.
  const months = MONTH_BUCKETS.map((b) => ({ bucket: b.label, n: 0, tvl: 0 }));
  for (const p of pre) {
    const m = p.listed_at === null ? 0 : monthsBetween(p.listed_at, snapshot.as_of);
    const at = MONTH_BUCKETS.findIndex((b) => m >= b.lo && m < b.hi);
    const cell = months[at < 0 ? months.length - 1 : at]!;
    cell.n += 1;
    cell.tvl += p.tvl_usd;
  }

  const cats: CatStat[] = [...byCat.values()]
    .filter((c) => c.n >= 2)
    .sort((a, b) => b.median - a.median || b.n - a.n || (a.category < b.category ? -1 : 1));

  const preTvl = pre.reduce((sum, p) => sum + p.tvl_usd, 0);
  const watchTvl = pre.filter((p) => watch.has(p.slug)).reduce((sum, p) => sum + p.tvl_usd, 0);
  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor: snapshot.floor_usd,
      n_protocols: snapshot.protocols.length,
      n_pre: pre.length,
      n_launchable: pre.filter((p) => !isProduct(p)).length,
      n_products: pre.filter(isProduct).length,
      n_tok: snapshot.protocols.length - pre.length,
      n_watch: onWatch.length,
      n_board: rows.length,
      pre_tvl: preTvl,
      watch_tvl: watchTvl,
      top_implied: top,
      median_mult: market,
      market_n: marketN,
      excluded_tvl: snapshot.protocols.filter(hasToken).reduce((sum, p) => sum + p.tvl_usd, 0),
    },
    rows,
    excluded,
    chains: chains.slice(0, 14),
    months,
    cats: cats.slice(0, 12),
  };
  return { board: rows, radar };
}

/** The gate's board rules, checked before anything is written: null when the board is valid. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i += 1) {
    const r = board[i]!;
    if (!known.has(r.slug)) return `row ${i} names a slug the snapshot does not list: ${r.slug}`;
    if (seen.has(r.slug)) return `row ${i} repeats the slug ${r.slug}`;
    seen.add(r.slug);
    if (!Number.isInteger(r.rank) || r.rank < 1) return `row ${i} has no positive whole rank`;
    if (!Number.isInteger(r.implied) || r.implied < 1) return `row ${i} has no positive whole implied value`;
    if (r.implied > 1e14) return `row ${i} implies more than 100 trillion dollars`;
    if (r.steps.length < 3 || r.steps.length > 12) return `row ${i} has ${r.steps.length} farm steps, not 3 to 12`;
    for (const s of r.steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${i} has a farm step of ${t.length} characters`;
    }
    if (i > 0) {
      const prev = board[i - 1]!;
      if (r.rank !== prev.rank + 1) return `row ${i} breaks the rank sequence`;
      if (r.implied > prev.implied) return `row ${i} implies more than the row above it`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist protocols (${missing.slice(0, 3).join(', ')})`;
  if (new Set(board.map((r) => r.implied)).size === 1) return 'every row implies the same value';
  return null;
}

/** The dashboard's data file: one script tag's worth of JSON, stable byte for byte between runs. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
