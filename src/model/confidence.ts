import type { Channel, Config, Rec } from './types';
import { CH } from './defaults';
import { type Ctx, makeCtx } from './ctx';
import { getTeams, isOpenIv, weekdayOpen, weekendOpen, coverOK } from './demand';
import { coverage, longLen, longOn } from './shifts';
import { computePlans, computeRec, sizing } from './plan';
import { runMC } from './montecarlo';
import { clamp } from './util';

/** The weakest of the likelihoods that matter (each SLA metric in force). */
export function worstP(ctx: Ctx, P: Record<Channel | 'ab', number | null>): number {
  const S = ctx.S, v: number[] = [];
  for (const c of CH) if (S.ch[c].on && P[c] != null) v.push(P[c]!);
  if (S.model === 'A' && S.ch.voice.on && P.ab != null) v.push(P.ab);
  return v.length ? Math.min(...v) : 1;
}

/** Period the confidence aim is measured over. Contract-based aims are always monthly. */
export const confPeriodNow = (S: Config) => (S.confMode === 'pct' ? S.confPeriod : 'month');

/** Share of simulated periods that must hit every target, from the way the aim is expressed. */
export function confTarget(S: Config): number {
  const N = Math.max(1, Math.round(+S.contractMonths || 84));
  if (S.confMode === 'misses') return clamp(1 - Math.max(0, +S.missesAllowed || 0) / N, 0.5, 1);
  if (S.confMode === 'clean') return clamp(Math.pow(clamp(+S.cleanChance || 90, 1, 99.9) / 100, 1 / N), 0.5, 1);
  return clamp((+S.conf || 99) / 100, 0.5, 1);
}

/** Enough agents to have someone on seat through the opening hours at all (long weekend shifts cover more each). */
export function coverMin(ctx: Ctx, k: 'wd' | 'we' = 'wd'): number {
  let n = 0;
  for (let i = 0; i < 48; i++) if (isOpenIv(ctx, i)) n++;
  return Math.max(1, Math.ceil(n / (k === 'we' && longOn(ctx, 5) ? longLen(ctx) : 16)));
}
/** The confidence search never goes below 80% of the forecast roster, nor below the minimum-staffing roster. */
export function slotFloor(ctx: Ctx, base: Rec, minh: Rec, id: string, k: 'wd' | 'we'): number {
  const b = (base[id] && base[id][k]) || 0;
  return b ? Math.max(coverMin(ctx, k), Math.ceil(b * 0.8), (minh[id] && minh[id][k]) || 0) : 0;
}
export function scaleRec(ctx: Ctx, base: Rec, minh: Rec, f: number): Rec {
  const o: Rec = {};
  for (const id in base) {
    const b = base[id];
    o[id] = { wd: b.wd ? Math.max(slotFloor(ctx, base, minh, id, 'wd'), Math.round(b.wd * f)) : 0, we: b.we ? Math.max(slotFloor(ctx, base, minh, id, 'we'), Math.round(b.we * f)) : 0 };
  }
  return o;
}

/** Likelihood that every target is met in a simulated period with this roster; -1 if the plan breaks minimum cover. */
export function periodP(ctx: Ctx, hc: Rec): number {
  const plan = computePlans(ctx, hc);
  for (const t of getTeams(ctx)) for (let d = 0; d < 7; d++)
    if (ctx.S.openDays[d] && plan[d][t.id].length && !coverOK(ctx, t, d, coverage(ctx, plan[d][t.id]).on)) return -1;
  return worstP(ctx, runMC(ctx, { period: confPeriodNow(ctx.S) === 'week' ? 'week' : 'month', hc, plan, seed: 4242 }).P);
}

export interface ConfResult {
  hc: Rec; p: number | null; f: number;
  /** True when sociable start times would have missed the aim at this roster, so the rota should be placed purely on cover. */
  plain: boolean;
}

/**
 * Smallest roster that hits every target in the aimed-for share of simulated periods.
 * Stage 1 scales every team by the same factor to get close; stage 2 takes agents out one at a time from whichever
 * team and day type can spare one, keeping the removal that leaves the best odds, until none can come out.
 */
export function searchConfidence(ctxIn: Ctx, rec0: Rec, minh: Rec, budgetMs = 8000): ConfResult {
  // The roster is always found with rotas placed purely on cover, so start-time preferences can never add headcount.
  // Afterwards the sociable rota is checked at that same roster; if it falls short of the aim, the plain rota is used.
  const prefs = ctxIn.S.shiftPrefs !== false && !ctxIn.plainPlans;
  const ctx: Ctx = prefs ? { ...makeCtx(ctxIn.S), plainPlans: true } : ctxIn;
  const target = confTarget(ctx.S), t0 = Date.now(), fte = (hc: Rec) => sizing(ctx, hc).tot.contract;
  let lo: number, hi: number, pHi: number | null = null;
  const p1 = periodP(ctx, scaleRec(ctx, rec0, minh, 1));
  if (p1 >= target) { hi = 1; pHi = p1; lo = 0.5; }
  else {
    lo = 1; hi = 1.25;
    while (hi < 2.5) { const ph = periodP(ctx, scaleRec(ctx, rec0, minh, hi)); if (ph >= target) { pHi = ph; break; } lo = hi; hi += 0.25; }
  }
  for (let steps = 0; hi - lo >= 0.02 && steps <= 7; steps++) {
    const mid = (lo + hi) / 2, pm = periodP(ctx, scaleRec(ctx, rec0, minh, mid));
    if (pm >= target) { hi = mid; pHi = pm; } else lo = mid;
  }
  let cur = scaleRec(ctx, rec0, minh, hi);
  for (;;) {
    let best: { hc: Rec; p: number } | null = null, late = false;
    for (const id in cur) for (const k of ['wd', 'we'] as const) {
      if (!(cur[id][k] > slotFloor(ctx, rec0, minh, id, k) && (k === 'wd' ? weekdayOpen(ctx) : weekendOpen(ctx)))) continue;
      if (Date.now() - t0 > budgetMs) { late = true; break; }
      const cand: Rec = JSON.parse(JSON.stringify(cur)); cand[id][k]--;
      const pc = periodP(ctx, cand);
      if (pc >= target && (!best || pc > best.p || (pc === best.p && fte(cand) < fte(best.hc)))) best = { hc: cand, p: pc };
    }
    if (best) { cur = best.hc; pHi = best.p; }
    if (!best || late) break;
  }
  let plain = !!ctxIn.plainPlans || !prefs, p = pHi;
  if (prefs && pHi != null) { const pp = periodP(ctxIn, cur); if (pp >= target) p = pp; else plain = true; }
  return { hc: cur, p, f: fte(rec0) ? fte(cur) / fte(rec0) : 1, plain };
}

/** FTE needed at other call targets (forecast-based), holding everything else the same. */
export function tradeGrid(S: Config) {
  const v = S.ch.voice;
  const pcts = [...new Set([70, 80, 90, v.slPct])].sort((a, b) => a - b), secs = [...new Set([20, 30, 60, v.slSec!])].sort((a, b) => a - b);
  const res: Record<string, number> = {};
  for (const p of pcts) for (const sc of secs) {
    const S2: Config = structuredClone(S); S2.ch.voice.slPct = p; S2.ch.voice.slSec = sc;
    const c2 = makeCtx(S2);
    res[p + '|' + sc] = sizing(c2, computeRec(c2).rec).tot.contract;
  }
  return { pcts, secs, res };
}
