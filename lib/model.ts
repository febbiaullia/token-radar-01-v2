// The token radar's scoring model (radar-2), rewritten for clarity: same figures in,
// same board out.
//
// The entry reads one sealed snapshot of the protocol universe and ranks the protocols
// that record no token yet. The watchlist is the floor, never the ceiling: every watchlist
// slug is on the board, and the early rows carry the rankable pre-token protocols below
// the watchlist floor, strongest TVL first. Protocols whose token already trades are kept
// apart as the live set and shown at the market's own values.
//
// An implied value is built only from the snapshot's own numbers. Its base multiple comes
// from the snapshot itself: per category, the median market-cap-to-TVL ratio of that
// category's live-token protocols (three or more of them, else the live set's overall
// median). Dexs land near 0.34, Lending near 0.13, Liquid Staking near 0.03; the multiple
// is held to [0.02, 1.0] so no single category runs away with the board, and CEX never
// enters the calibration (exchange tokens do not price like protocol tokens).
//
//   base       = median live mcap_usd / tvl_usd, per category (n >= 3) else overall median,
//                held to [0.02, 1.0]
//   growth     = change_7d held to [-60, 120] per cent
//   growthMul  = 1 + (growth / 100) x growth_weight
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied    = max(1, round(tvl_usd x base x growthMul x maturity))
//
// Nothing here names a protocol: one function scores every row, and the constants below
// are the same ones the dashboard prints, so the page can replay the model exactly.

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A finite number, or `fallback` when the value is missing or not a number. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of numbers already sorted ascending. */
function midValue(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Four-decimal rounding, for the multipliers the board carries. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when a date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / DAY_MS));
}

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

/** The sealed snapshot document as the model receives it. */
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}

/** The model's tunable constants; the dashboard prints these and the page may replay them. */
export interface ModelConstants {
  growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number; unknown_age_days: number;
  multiple_min: number; multiple_max: number; multiple_min_n: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120, maturity_floor: 0.6, maturity_range: 0.4,
  maturity_days: 1095, unknown_age_days: 365, multiple_min: 0.02, multiple_max: 1.0, multiple_min_n: 3,
};

/** The model's version label, shown by the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many early protocols below the floor the board carries, strongest TVL first. */
export const EARLY_ROWS = 1000;

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep { text: string; cost: string; time: string }

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null; implied_value_usd: number;
  model: { category_multiple: number; category_live_n: number; multiple_fallback: boolean; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null };
  farm_steps: string[];
}

/** A board row slimmed down for data.js; the page builds the farm plan from it. */
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number;
  category_multiple: number; growth_multiplier: number; maturity_multiplier: number;
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}

/** One calibrated multiple with the live count that set it. */
export interface CategoryMultiple { category: string; multiple: number; live_n: number; fallback: boolean }

/** Everything the dashboard renders, built from one snapshot. */
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number;
  overall_multiple: number; multiples: CategoryMultiple[]; rows: RadarRow[]; live: LiveRow[];
}

/** The headline counts: watchlist size, board size, early rows, live rows. */
export interface BoardSummary { watchlist_size: number; board_size: number; early_size: number; live_size: number }

/** Thrown when a snapshot is not shaped the way this model scores it. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/**
 * Calibrate the base multiples from the snapshot's live-token protocols: the median
 * market-cap-to-TVL ratio of each category (only categories with at least
 * `multiple_min_n` live protocols count), held to [multiple_min, multiple_max]; a
 * category short on live protocols falls back to the live set's overall median. CEX
 * stays out entirely. Categories run in sorted order so the result is deterministic.
 */
export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { overall: number; byCategory: Map<string, CategoryMultiple> } {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  // Every multiple is held to [multiple_min, multiple_max] so one outlier cannot run away with the board.
  const clampToRange = (x: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, x));
  const ratios = (ps: SnapshotProtocol[]): number[] => ps.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const overall = clampToRange(midValue(ratios(live)));
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key);
    if (list) list.push(p);
    else grouped.set(key, [p]);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const key of [...grouped.keys()].sort()) {
    const members = grouped.get(key)!;
    const short = members.length < model.multiple_min_n;
    byCategory.set(key, { category: key, multiple: short ? overall : clampToRange(midValue(ratios(members))), live_n: members.length, fallback: short });
  }
  return { overall, byCategory };
}

/** The multiple one protocol scores with: its category's, or the overall median. */
export function multipleFor(
  p: SnapshotProtocol,
  calibration: { overall: number; byCategory: Map<string, CategoryMultiple> },
): CategoryMultiple {
  const entry = calibration.byCategory.get(p.category ?? 'Other');
  if (entry !== undefined) return entry;
  return { category: p.category ?? 'Other', multiple: calibration.overall, live_n: 0, fallback: true };
}

/** One protocol's implied value and the three figures behind it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: { overall: number; byCategory: Map<string, CategoryMultiple> },
): { implied: number; multiple: CategoryMultiple; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol, calibration);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const aged = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(aged, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple.multiple * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a protocol. */
const VERSIONED = new RegExp('\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$');

/** True when a protocol records no token anywhere in its entry. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when a protocol may be ranked: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board: watchlist slugs first, then the early radar, strongest implied value first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrateMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug in it is ranked, even one the snapshot
  // no longer carries (it cannot be, but coverage is the gate's row and is never risked).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, by TVL.
  // A picked protocol stays picked; the early set never replaces a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) picked.set(p.slug, p);

  const ranked = [...picked.values()].map((p) => {
    const { implied, multiple, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, calibration);
    return { p, implied, multiple, growthPct, growthMult, maturityMult, age };
  });
  ranked.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return ranked.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied,
    model: { category_multiple: s.multiple.multiple, category_live_n: s.multiple.live_n, multiple_fallback: s.multiple.fallback, growth_pct: s.growthPct, growth_multiplier: round4(s.growthMult), maturity_multiplier: round4(s.maturityMult), age_days: s.age },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: action, then cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocol's first chain, or a neutral phrase when it names none. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, set by the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The hold window in days: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, as a label and two figures. */
function feeTier(chain: string): { label: string; tx: string; week: string } {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return { label: 'Ethereum mainnet gas', tx: 'about $4 of gas', week: 'about $4 of gas a week' };
  if (c.includes('solana')) return { label: 'Solana fees', tx: 'under $0.10 of fees', week: 'under $0.10 of fees a week' };
  if (c.includes('binance') || c.includes('bsc')) return { label: 'BNB Chain gas', tx: 'about $0.20 of gas', week: 'about $0.20 of gas a week' };
  if (c.includes('tron')) return { label: 'Tron energy', tx: 'about $1 of energy', week: 'about $1 of energy a week' };
  return { label: 'layer-2 gas', tx: 'under $0.50 of gas', week: 'under $0.50 of gas a week' };
}

/** The one action for a protocol's category, written so a farmer can follow it. */
function planAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator') || c.includes('onchain capital'))
    return `Deposit $${capital} of USDC into a vault ${name} curates on ${chain} and keep the shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Route $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('governance')) return `Lock $${capital} of voting power through ${name} on ${chain} and vote once.`;
  if (c.includes('privacy')) return `Move $${capital} through ${name}'s private pool on ${chain} and keep the note.`;
  if (c.includes('chain')) return `Use $${capital} in ${name}'s app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. Every step is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas follows the protocol's main chain, so an Ethereum farm
 * never pretends to cost layer-2 money.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = mainChain(p);
  const capital = stakeSize(p);
  const hold = holdWindow(age);
  const fee = feeTier(chain);
  const action = planAction(p, capital, chain);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'nothing but the wallet', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and ${fee.tx}`, time: '15 minutes to set up' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: fee.week, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`, cost: 'no fee to check', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
    }));
}

/** A board row slimmed down for data.js; the page builds the farm plan from it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple, growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, built from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrateMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiples: CategoryMultiple[] = [...calibration.byCategory.values()].sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: board.length, early_size: early, live_size: live.length,
    overall_multiple: calibration.overall, multiples, rows: board.map(radarRow), live,
  };
  return { board, radar };
}

/** A snapshot parsed out of a file's text, refused unless it is shaped to score. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot file is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('the snapshot file is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('the snapshot file has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('the snapshot file has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('the snapshot file has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('the snapshot file has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('the snapshot file has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} of the snapshot is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} of the snapshot lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null, symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} reads ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} carries ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} carries a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} carries implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
