// The Token Radar value model: one sealed snapshot in, one ranked board out.
//
// WHAT THIS FILE DOES, IN TWO STEPS, NEITHER OF WHICH KNOWS A PROTOCOL'S NAME
//
// 1. CALIBRATE, from the snapshot itself, on every run. The snapshot carries 416 protocols whose token
//    already trades; 128 of them also carry a market cap, a TVL and no zero in either. Those 128 are the
//    only evidence the file holds about what a DeFi protocol is worth next to its TVL, so the model fits
//    its coefficients on them rather than asserting them:
//
//      log10(mcap_usd) = intercept + size_exp * log10(tvl_usd) + growth_coef * growth + category residual
//
//    One ordinary-least-squares solve, B the exponent of a power law over size, plus a per-category
//    residual shrunk toward zero by empirical Bayes (n / (n + K)) and clamped, so a category that one
//    protocol happens to sit in cannot dominate the board. There is no hardcoded list of names anywhere
//    in this file: run it on another snapshot and every coefficient moves.
//
// 2. SCORE, for every protocol that records no token:
//
//      implied = 10^(intercept + size_exp*log10(base_tvl) + momentum_weight*rel_growth/100 + log10(cat))
//                * tenure(age_days),   floored at $1 and capped at $100tn
//
//    rel_growth is (change_7d - tide), where tide is the snapshot's own median seven-day move across
//    every protocol that reports one. A protocol is marked up for growing faster than the field and down
//    for falling behind it, never for the field's own direction, which on this snapshot runs at -8.23%
//    and would otherwise tax every row equally.
//    base_tvl is tvl_usd with the week's own move taken back out (tvl_usd / (1 + change_7d/100), clamped
//    to a move between -60% and +150%). Without it the seven-day move enters the score twice, once in
//    the size the market cap is compared against and once in the growth term, and the two fight: that is
//    the reason the raw cross-sectional fit puts a negative sign on change_7d at all. Take the move out
//    of the size and apply it once, as a tilt, and the fit stops objecting to it.
//
// THE TWO TERMS THE FIT CANNOT SET, SAID PLAINLY (both are on the dashboard as well)
//
// - The magnitude of the growth weight. The raw fit prices a week's move at about -1.35 in log10 per
//   unit of growth, which is a same-day artefact rather than a finding: the snapshot's market caps and its
//   TVL print were read at the same instant, so a protocol that just printed +60% of TVL carries a market
//   cap set before that move. Backing the move out of the size removes much of the effect but not the
//   collinearity, so the model states the sign a reader expects, positive, and damps the magnitude to
//   MOMENTUM_WEIGHT. What it costs is printed in the dashboard: on this snapshot, R2 0.1988 with growth
//   ignored against 0.1942 at the weight used, on the log10 scale, over the same 128 priced protocols.
// - Tenure. None of the snapshot's priced protocols is pre-token, so the file holds no evidence at all
//   about what a long run with no token is worth. TENURE is a stated, bounded prior, not a fitted number:
//   a protocol that has run for years with no token has banked more usage that a launch would convert.
//   It is a multiplier between 0.80 and 1.20, monotone in age, and identical for every protocol.
//
// Farm plans are derived the same way: from the protocol's own category, chains, TVL and age. Every step
// carries what it costs and how long it takes, and the page prints the same six steps board.json holds.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------------------------------ helpers

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The median of a list, on a copy; 0 for an empty list. */
function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2;
}

/** log10 of a positive dollar figure, floored so a zero never reaches the log. */
const log10Usd = (v: number): number => Math.log10(Math.max(v, 1));

/** A protocol records a token when either of the two token fields is set. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** A whole day count from `asOf` back to `listedAt`, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ---------------------------------------------------------------------------------- the stated priors

/** The tenure prior: a multiplier bounded to [0.80, 1.20], monotone in the years run without a token. */
export const TENURE_FLOOR = 0.8;
export const TENURE_RANGE = 0.4;
/** The age at which the tenure premium is full: five years with no token on record. */
export const TENURE_FULL_DAYS = 1825;
/** The age taken for a protocol the snapshot gives no listing date: the fitted set's own median. */
export const UNKNOWN_AGE_DAYS = 420;
/** The share of the fitted sign's magnitude the seven-day move actually carries. See the header. */
export const MOMENTUM_WEIGHT = 0.25;
/** How far one category may move a value, in log10 (0.35 is about a factor of 2.24 either way). */
export const CATEGORY_CLAMP = 0.35;
/** Empirical-Bayes shrinkage: a category needs this many samples to carry half its own signal. */
export const CATEGORY_SHRINK_K = 6;
/** How far the seven-day move may sit from the field's median before it stops moving the score. */
export const MAX_RELATIVE_GROWTH = 50;

/** The model's own name, as the dashboard prints it. */
export const MODEL_VERSION = 'radar-2-fit';

/** The three tiers every protocol on record falls into. */
export type TokenStatus = 'pre-token' | 'pre-token-set-aside' | 'live-token';

// -------------------------------------------------------------------------------------- calibration

/** What the fit found, carried into data.js so the page prints the numbers it actually used. */
export interface Calibration {
  /** The protocols the fit ran on: a token on record, a market cap and a TVL, all positive. */
  sample_size: number;
  /** The snapshot's own median seven-day move across every protocol reporting one, in per cent. */
  tide_pct: number;
  intercept: number;
  size_exp: number;
  /** What `size_exp` is the exponent of: the TVL with the week's own move taken back out. */
  size_basis: 'base_tvl';
  /** The exponent the fit alone put on the seven-day move: negative, with the cause in the header. */
  growth_coef_fitted: number;
  /** The weight the model actually applies to the move relative to the tide. */
  momentum_weight: number;
  /** R2 on the log10 scale, size only, and with the model's own growth weight in place. */
  r2_size_only: number;
  r2_with_momentum: number;
  /** The sample's median TVL, the model's own sense of scale. */
  median_sample_tvl_usd: number;
  /** What a ten-fold larger TVL multiplies a value by, straight out of size_exp. */
  ten_x_tvl_multiple: number;
  /** How much the median protocol's market cap runs above its TVL. */
  median_sample_ratio: number;
  /** The per-category multipliers, centred so a category the fit never saw is exactly 1.00. */
  category_multiplier: Record<string, number>;
  /** How many priced protocols carried each category. */
  category_sample: Record<string, number>;
}

/** How far the week's own move may be unwound from the size before the unwind stops: -60% to +150%. */
export const BASE_TVL_GROWTH_FLOOR = -0.6;
export const BASE_TVL_GROWTH_CAP = 1.5;

/**
 * The size the model compares a value against: the TVL the snapshot reports with the week's own move
 * taken back out, so the seven-day change enters the score once, as a tilt, and not also inside the
 * denominator. A protocol whose TVL just printed +80% is scored on the TVL it had before that print.
 */
export function baseTvl(p: SnapshotProtocol): number {
  const move = clamp((p.change_7d ?? 0) / 100, BASE_TVL_GROWTH_FLOOR, BASE_TVL_GROWTH_CAP);
  return Math.max(p.tvl_usd / (1 + move), 1);
}

/** The seven-day move as the fit uses it: scaled to a fraction and clamped, before any weighting. */
const fitGrowth = (change7d: number | null): number => clamp((change7d ?? 0) / 100, BASE_TVL_GROWTH_FLOOR, BASE_TVL_GROWTH_CAP);

/**
 * Fit the model's coefficients on the snapshot's own priced protocols, by ordinary least squares over
 * [1, log10(tvl), growth]. Deterministic: the same snapshot gives the same numbers, byte for byte.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const priced = snapshot.protocols.filter((p) => recordsToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  const tide = median(snapshot.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d!));

  const rows = priced.map((p) => [1, log10Usd(baseTvl(p)), fitGrowth(p.change_7d)]);
  const rel = priced.map((p) => clamp((p.change_7d ?? 0) - tide, -MAX_RELATIVE_GROWTH, MAX_RELATIVE_GROWTH));
  const y = priced.map((p) => log10Usd(p.mcap_usd ?? 1));
  const k = 3;
  const ata = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const aty = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      aty[a] += rows[i]![a]! * y[i]!;
      for (let c = 0; c < k; c++) ata[a]![c] += rows[i]![a]! * rows[i]![c]!;
    }
  }
  // A pinch on the diagonal keeps the solve stable if a column is nearly constant; at this sample size
  // it moves the coefficients by far less than the precision they are rounded to.
  for (let a = 1; a < k; a++) ata[a]![a] += 1e-9;
  const m = ata.map((row, i) => row.concat([aty[i]!]));
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    const swap = m[c]!;
    m[c] = m[pivot]!;
    m[pivot] = swap;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let cc = c; cc <= k; cc++) m[r]![cc]! -= f * m[c]![cc]!;
    }
  }
  const beta = m.map((row, i) => row[k]! / row[i]![i]!);
  const ok = rows.length >= 8 && beta.every((b) => Number.isFinite(b));
  const intercept = ok ? beta[0]! : 3.025;
  const sizeExp = ok ? beta[1]! : 0.522;
  const growthCoef = ok ? beta[2]! : -1.35;

  /** R2 on the log10 scale for a given weight on the seven-day move relative to the tide. */
  const r2 = (growthWeight: number): number => {
    if (rows.length === 0) return 0;
    const ybar = y.reduce((a, c) => a + c, 0) / y.length;
    let ssr = 0;
    let sst = 0;
    for (let i = 0; i < rows.length; i++) {
      const fitted = intercept + sizeExp * rows[i]![1]! + growthWeight * (rel[i]! / 100);
      ssr += (y[i]! - fitted) ** 2;
      sst += (y[i]! - ybar) ** 2;
    }
    return sst === 0 ? 0 : 1 - ssr / sst;
  };

  // The per-category residual, after size and the model's own momentum term: shrunk, then centred, so a
  // category the fit never saw is exactly 1.00 and the board has no systematic tilt by category.
  const residual = priced.map((p, i) => y[i]! - (intercept + sizeExp * rows[i]![1]! + MOMENTUM_WEIGHT * (rel[i]! / 100)));
  const byCat = new Map<string, number[]>();
  priced.forEach((p, i) => {
    const key = p.category ?? 'Uncategorised';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [residual[i]!]);
    else list.push(residual[i]!);
  });
  const rawAdj = new Map<string, number>();
  const categorySample: Record<string, number> = {};
  for (const [key, list] of byCat) {
    const n = list.length;
    const w = n / (n + CATEGORY_SHRINK_K);
    rawAdj.set(key, clamp(w * median(list), -CATEGORY_CLAMP, CATEGORY_CLAMP));
    categorySample[key] = n;
  }
  const centre = rawAdj.size > 0 ? median([...rawAdj.values()]) : 0;
  const categoryMultiplier: Record<string, number> = {};
  for (const [key, adj] of rawAdj) categoryMultiplier[key] = round6(Math.pow(10, adj - centre));

  return {
    sample_size: priced.length,
    tide_pct: round4(tide),
    intercept: round6(intercept),
    size_exp: round6(sizeExp),
    growth_coef_fitted: round4(growthCoef),
    momentum_weight: MOMENTUM_WEIGHT,
    r2_size_only: round4(r2(0)),
    r2_with_momentum: round4(r2(MOMENTUM_WEIGHT)),
    median_sample_tvl_usd: Math.round(median(priced.map((p) => p.tvl_usd))),
    ten_x_tvl_multiple: round4(Math.pow(10, sizeExp)),
    median_sample_ratio: round4(median(priced.map((p) => (p.mcap_usd ?? 0) / p.tvl_usd))),
    size_basis: 'base_tvl',
    category_multiplier: categoryMultiplier,
    category_sample: categorySample,
  };
}

/** The multiplier a category gets: the fit's own when it saw the category, exactly 1.00 when it did not. */
export function categoryMultiplier(cal: Calibration, category: string | null): number {
  if (category === null) return 1;
  return cal.category_multiplier[category] ?? 1;
}

/** The tenure prior, a multiplier in [0.80, 1.20] monotone in the days a protocol has run tokenless. */
export function tenureMultiplier(age: number | null): number {
  const days = clamp(age ?? UNKNOWN_AGE_DAYS, 0, TENURE_FULL_DAYS);
  const share = Math.log10(1 + days / 365) / Math.log10(1 + TENURE_FULL_DAYS / 365);
  return TENURE_FLOOR + clamp(share, 0, 1) * TENURE_RANGE;
}

/** The seven-day move relative to the snapshot's tide, in points, clamped to +-50. */
export function relativeGrowth(change7d: number | null, tidePct: number): number {
  return clamp((change7d ?? 0) - tidePct, -MAX_RELATIVE_GROWTH, MAX_RELATIVE_GROWTH);
}

/** One protocol's derivation, every term the dashboard prints. */
export interface Derivation {
  age_days: number | null;
  tide_pct: number;
  base_tvl_usd: number;
  relative_growth_pct: number;
  size_multiple: number;
  growth_multiplier: number;
  category_adj: number;
  category_multiplier: number;
  tenure_multiplier: number;
  implied_value_usd: number;
}

/** The implied value one protocol gets under `cal`, with every term kept so the page can show its work. */
export function derive(p: SnapshotProtocol, cal: Calibration, asOf: string): Derivation {
  const age = ageDays(asOf, p.listed_at);
  const rel = relativeGrowth(p.change_7d, cal.tide_pct);
  const catAdj = clamp(Math.log10(categoryMultiplier(cal, p.category)), -CATEGORY_CLAMP, CATEGORY_CLAMP);
  const cat = Math.pow(10, catAdj);
  const tenure = tenureMultiplier(age);
  const base = baseTvl(p);
  const sizeLog = cal.size_exp * log10Usd(base);
  const growthMult = Math.pow(10, cal.momentum_weight * (rel / 100));
  const logValue = cal.intercept + sizeLog + Math.log10(growthMult) + catAdj;
  const implied = Math.max(1, Math.round(Math.min(Math.pow(10, logValue) * tenure, 100_000_000_000_000)));
  return {
    age_days: age,
    tide_pct: cal.tide_pct,
    base_tvl_usd: Math.round(base),
    relative_growth_pct: round4(rel),
    size_multiple: round4(Math.pow(10, sizeLog)),
    growth_multiplier: round4(growthMult),
    category_adj: round4(catAdj),
    category_multiplier: round4(cat),
    tenure_multiplier: round4(tenure),
    implied_value_usd: implied,
  };
}

// ------------------------------------------------------------------------------- the board's universe

/** DefiLlama's version-marker rule: a name ending in a release names a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The categories the watchlist's own rule sets aside: a bridge, a staking receipt, an exchange. */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's own brand at the front of a name names a product of that exchange, not a launch. */
const EXCHANGE_BRAND = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;
/** A whole word wrapped, staked or staking names a receipt for an asset that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a protocol that records no token is not a launch candidate, or null when it is one. The house's
 * own watchlist rule, applied to the whole snapshot rather than only to what sits above its floor: an
 * exchange, a bridge, a staking receipt or a wrapped product is a claim on an asset that already trades,
 * so the token it would issue is not a launch anyone is waiting for.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  const c = p.category;
  if (c !== null && SET_ASIDE_CATEGORIES.has(c)) {
    if (c === 'CEX') return 'an exchange, whose TVL is its customers\u2019 assets rather than its own';
    if (c === 'Bridge' || c === 'Canonical Bridge') return 'a bridge, holding other chains\u2019 assets rather than its own';
    return 'a staking receipt, so a claim on an asset that already trades';
  }
  if (VERSIONED.test(p.name)) return 'a later release of another protocol\u2019s pool';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product, named in its own record';
  if (EXCHANGE_BRAND.test(p.name)) return 'branded by an exchange, so a product of that exchange';
  return null;
}

/** Whether a protocol is one the board ranks: it records no token, and is not set aside. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return !recordsToken(p) && setAsideReason(p) === null;
}

// ------------------------------------------------------------------------------------------ farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** What one transaction costs on a chain, as a band, so no step ever quotes a false precision. */
function gasBand(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return '$2 to $10';
  if (c.includes('bitcoin')) return '$1 to $5';
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('near')) return 'under $0.05';
  if (c.includes('arbitrum') || c.includes('base') || c.includes('optimism')) return 'under $0.50';
  if (c.includes('polygon') || c.includes('binance') || c.includes('avalanche') || c.includes('monad') || c.includes('berachain')) return 'under $0.30';
  if (c.includes('flare') || c.includes('stellar') || c.includes('algorand') || c.includes('plasma') || c.includes('sonic')) return 'under $0.10';
  return 'under $2';
}

/** The chain a plan is written against: the first the protocol's own record names. */
function primeChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one position needs, from the protocol's own TVL tier. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 250_000_000) return 100;
  if (tvlUsd >= 50_000_000) return 75;
  return 40;
}

/** How long to hold, from the protocol's age: a younger protocol gets a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's qualifying action, and the second surface that widens the same address's footprint. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { open: string; widen: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      open: `Deposit $${capital} of USDC into a vault ${name} curates or allocates on ${chain}, and keep the receipt token.`,
      widen: `Route a smaller amount through a second strategy ${name} runs, so two vaults carry the address rather than one.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave the position open.`,
      widen: `Borrow a small amount against that collateral and repay it within the week, so the address shows both sides of the market.`,
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return {
      open: `Provide $${capital} of liquidity to the deepest pool ${name} runs on ${chain}, in two assets, and hold the position token.`,
      widen: `Swap through ${name} in both directions to move its volume figure, and stake the liquidity receipt if it issues one.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      open: `Bridge $${capital} of USDC into ${chain} through ${name} and use the funds in an app on the far side.`,
      widen: `Bridge a second, smaller amount back the other way, so both chains and both directions carry the address.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      open: `Stake $${capital} of ${chain}\u2019s staking asset through ${name} and keep the receipt token.`,
      widen: `Restake or delegate the receipt once more where ${name} allows it, so the position compounds instead of sitting idle.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('interest rate')) {
    return {
      open: `Deposit $${capital} of USDC as margin on ${name} and hold one small hedge open through the window.`,
      widen: `Place one trade on a second market ${name} lists, so the volume is not a single position.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `Fund $${capital} into ${name} and hold positions on two markets that resolve on different dates.`,
      widen: `Make one trade on a market other than the first, and let both settle rather than closing early.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      open: `Mint or deposit $${capital} of the yield asset ${name} issues on ${chain} and hold it for a full cycle.`,
      widen: `Move the position into a second venue that accepts ${name}\u2019s asset, so two protocols count the address.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      open: `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold.`,
      widen: `Add cover on a second protocol ${name} underwrites, so the premium is not a one-off payment.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      open: `Fund $${capital} through ${name} on ${chain} and move it out in more than one transaction.`,
      widen: `Send a second, smaller amount along a different route ${name} offers, and keep both receipts.`,
    };
  }
  if (c.includes('governance')) {
    return {
      open: `Lock $${capital} of the assets ${name} rewards on ${chain} and keep them locked past the next epoch.`,
      widen: `Vote on one live proposal ${name} raises rather than only holding the locked position.`,
    };
  }
  if (c.includes('liquidity manager') || c.includes('vault') || c.includes('index')) {
    return {
      open: `Deposit $${capital} into a vault ${name} runs on ${chain} and keep the share token.`,
      widen: `Move a smaller amount into a second vault ${name} runs, so two strategies see the address.`,
    };
  }
  return {
    open: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the next snapshot.`,
    widen: `Use one more feature ${name} ships, such as its swap route or its governance lock, on the same address.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, every one of them derived
 * from the protocol's own record. Nothing here reads the protocol's name.
 */
export function farmStepsFor(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primeChain(p);
  const gas = gasBand(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = Math.max(3, Math.round(hold / 7) - 1);
  const { open, widen } = actionsFor(p, capital, chain);
  const months = Math.round((age ?? UNKNOWN_AGE_DAYS) / 30.4);
  const tenureLine = p.listed_at === null
    ? `Its record carries no listing date, so treat how long it has run as unproven and hold the whole window.`
    : `Its record shows tracking since ${p.listed_at}, about ${months} months with no token on it, and the longer that run the more usage a launch would convert.`;
  return [
    {
      text: `Open a wallet used for this position alone, write its seed phrase down offline, and fund it from a source you are content to have linked to the address.`,
      cost: `about ${gas} for the first transaction on ${chain}`,
      time: '10 minutes',
    },
    { text: open, cost: `$${capital} of capital plus about ${gas} of gas on ${chain}`, time: '20 minutes to open' },
    { text: widen, cost: `about ${gas} of gas, and no capital beyond the $${capital} already deployed`, time: '15 minutes' },
    {
      text: `${tenureLine} Do one qualifying action a week for ${weeks} weeks on the same address, without withdrawing in between.`,
      cost: `about ${gas} of gas a week, so roughly $${Math.max(4, weeks * 3)} in fees across the window`,
      time: `${weeks} weeks, about 10 minutes a week`,
    },
    {
      text: `Keep the $${capital} deployed for at least ${hold} days, so the activity lands in more than one snapshot rather than one spiky week.`,
      cost: `$${capital} stays in the position and cannot be spent elsewhere`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, check where this protocol publishes any points or claim, never sign a claim reached from a link you did not find on its own page, and write the address, dates and every transaction into a farm log.`,
      cost: 'nothing, and never pay a fee to claim',
      time: '15 minutes to write up',
    },
  ];
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position, and read the protocol's own page before you move anything.`;
  return s;
}

/** What the snapshot records about a row, in one line, so a reader can check the model's inputs. */
export function evidenceFor(p: SnapshotProtocol, age: number | null, cal: Calibration): string {
  const parts: string[] = [];
  parts.push(`$${(p.tvl_usd / 1e6).toFixed(1)}M of TVL`);
  parts.push(p.change_7d === null
    ? `no seven-day change reported, so the field median of ${cal.tide_pct.toFixed(2)}% is applied`
    : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(2)}% over seven days against a field median of ${cal.tide_pct.toFixed(2)}%, so the size it is scored on is $${(baseTvl(p) / 1e6).toFixed(1)}M rather than the $${(p.tvl_usd / 1e6).toFixed(1)}M printed`);
  parts.push(age === null
    ? 'no listing date recorded, so the model assumes the sample median of 420 days'
    : `tracked about ${Math.round(age / 30.4)} months with no token on record`);
  parts.push('no market cap, no CoinGecko id and no ticker in its record, so it records no token');
  return `${parts.join('; ')}.`;
}

// ---------------------------------------------------------------------------------------------- board

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  token_status: TokenStatus;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  evidence: string;
  farm_steps: string[];
  model: {
    intercept: number;
    size_exp: number;
    momentum_weight: number;
    base_tvl_usd: number;
    relative_growth_pct: number;
    growth_multiplier: number;
    category_multiplier: number;
    tenure_multiplier: number;
  };
}

/** A protocol whose token already trades: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  ratio: number | null;
}

/** A pre-token protocol the ranking sets aside, with the reason, for the dashboard's third view. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  reason: string;
}

/** A row as the dashboard carries it: the whole board row plus the derivation's terms, flattened. */
export interface RadarRow extends Omit<BoardRow, 'model'> {
  base_tvl_usd: number;
  growth_multiplier: number;
  category_multiplier: number;
  tenure_multiplier: number;
}

/** Everything the dashboard renders, all of it derived from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  protocols_seen: number;
  /** How many of the snapshot's protocols record a token at all, whether or not it is priced. */
  live_total: number;
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/**
 * The ranked board: every launch candidate the snapshot holds, ranked by implied value. The watchlist
 * is the floor and never the ceiling, so the candidates below the floor are on the board too.
 */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols.filter(isLaunchCandidate).map((p) => ({ p, d: derive(p, cal, snapshot.as_of) }));
  scored.sort((a, b) => b.d.implied_value_usd - a.d.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.d.age_days,
    implied_value_usd: s.d.implied_value_usd,
    evidence: evidenceFor(s.p, s.d.age_days, cal),
    farm_steps: farmStepsFor(s.p, s.d.age_days).map(stepText),
    model: {
      intercept: cal.intercept,
      size_exp: cal.size_exp,
      momentum_weight: cal.momentum_weight,
      base_tvl_usd: s.d.base_tvl_usd,
      relative_growth_pct: s.d.relative_growth_pct,
      growth_multiplier: s.d.growth_multiplier,
      category_multiplier: s.d.category_multiplier,
      tenure_multiplier: s.d.tenure_multiplier,
    },
  }));
}

/** The token-bearing protocols, by market cap, for the dashboard's live-token view. */
export function liveRows(snapshot: Snapshot, limit: number): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      ratio: (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 ? round4((p.mcap_usd ?? 0) / p.tvl_usd) : null,
    }));
}

/** The pre-token protocols the ranking sets aside, and why, most TVL first. */
export function setAsideRows(snapshot: Snapshot, limit: number): SetAsideRow[] {
  const out: SetAsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) continue;
    const reason = setAsideReason(p);
    if (reason === null) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      reason,
    });
  }
  return out.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)).slice(0, limit);
}

/** A board row's dashboard form: the same plan board.json carries, so page and data cannot disagree. */
export function radarRow(row: BoardRow): RadarRow {
  const { model, ...rest } = row;
  return {
    ...rest,
    base_tvl_usd: model.base_tvl_usd,
    growth_multiplier: model.growth_multiplier,
    category_multiplier: model.category_multiplier,
    tenure_multiplier: model.tenure_multiplier,
  };
}

/** How many live-token and set-aside protocols the dashboard's other two views carry. */
export const LIVE_ROWS = 120;
export const SET_ASIDE_ROWS = 90;

/** The whole dashboard dataset, and the board beside it. */
export function buildRadar(snapshot: Snapshot, cal: Calibration = calibrate(snapshot)): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot, LIVE_ROWS);
  const setAside = setAsideRows(snapshot, SET_ASIDE_ROWS);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: cal,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    set_aside_size: setAside.length,
    protocols_seen: snapshot.protocols.length,
    live_total: snapshot.protocols.filter((p) => recordsToken(p)).length,
    rows: board.map(radarRow),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ------------------------------------------------------------------- the gate's own shape, re-checked

/** Why a board is not one the gate will take, or null: every row of the gate's board checks, in order. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has an implied value over the cap`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value, so the board ranks nothing by value`;
  }
  return null;
}

// -------------------------------------------------------------------------------------- the reader

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
