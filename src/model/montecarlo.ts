import type { Channel, Plan, Rec, Sched } from './types';
import { CH } from './defaults';
import { type Ctx } from './ctx';
import { attend, getTeams } from './demand';
import { type DaySummary, evalDay, summarise } from './evaluate';
import { plannedSched, rosterSize } from './plan';
import { clamp, gaussFrom, hashStr, lerp, mulberry } from './util';

/** Volume multipliers the day is pre-evaluated at; simulated days interpolate between them. */
export const GRID = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
export const G1 = 4; // index of the forecast (x1.0)

type Tot = { off: number; sla: number; ab: number };
export interface Mini {
  voice: Tot & { asa: number; slc: number }; chat: Tot & { asa: number; slc: number }; email: Tot & { asa: number; slc: number }; ticket: Tot & { asa: number; slc: number };
  lang: Record<string, Record<Channel, Tot>>; occ: number; busy: number; avail: number;
}

export function mini(s: DaySummary): Mini {
  const o: any = {};
  for (const c of CH) o[c] = { off: s.ch[c].off, sla: s.ch[c].sla, ab: s.ch[c].ab, asa: s.ch[c].asa, slc: s.ch[c].slc };
  o.lang = {};
  for (const L in s.lang) { o.lang[L] = {}; for (const c of CH) o.lang[L][c] = { off: s.lang[L][c].off, sla: s.lang[L][c].sla, ab: s.lang[L][c].ab }; }
  o.occ = s.avail > 0 ? s.busy / s.avail : 0; o.busy = s.busy; o.avail = s.avail;
  return o;
}

export function interp(g: Mini[], m: number): Record<Channel, Tot> {
  const p = clamp((m - 0.6) / 0.1, 0, 9.9999), lo = Math.floor(p), t = p - lo, A = g[lo], B = g[lo + 1], o = {} as Record<Channel, Tot>;
  for (const c of CH) o[c] = { off: lerp(A[c].off, B[c].off, t), sla: lerp(A[c].sla, B[c].sla, t), ab: lerp(A[c].ab, B[c].ab, t) };
  return o;
}

export type Period = 'day' | 'week' | 'month';
export interface MCInput {
  period: Period;
  hc: Rec;
  plan: Plan;
  /** Today only: the live day (its weekday, who's actually on seat, any incident boost). */
  live?: { dow: number; sched: Sched; boost?: Float64Array | null; key: string };
  seed?: number;
  runs?: number;
}
export interface MCResult {
  period: Period; days: number[];
  exp: { ch: Record<Channel, Tot & { asa: number; slc: number }>; lang: Record<string, Record<Channel, Tot>>; perDay: Mini[]; busy: number; avail: number };
  P: Record<Channel | 'ab', number | null>;
  samples: Record<Channel, number[]>;
}

/**
 * Simulate the period many times (500 by default). Each simulated day's volume is drawn around the forecast using
 * the forecast accuracy (with a shared element, so a busy period tends to stay busy) and, for planned days, a random
 * number of agents is off; fewer agents in reads as proportionally more load per agent. Seeded from the scenario,
 * so the figures only move when something that affects them changes.
 */
export function runMC(ctx: Ctx, inp: MCInput): MCResult {
  const S = ctx.S, { period } = inp, R = inp.runs ?? 500;
  let seed = inp.seed;
  if (!seed) { let key = JSON.stringify({ ...S, name: '' }) + '|' + period; if (period === 'day' && inp.live) key += '|' + inp.live.key; seed = hashStr(key) || 1; }
  const rnd = mulberry(seed), gz = () => gaussFrom(rnd);
  const dow = inp.live?.dow ?? 0;
  const days = period === 'day' ? [dow] : period === 'week' ? [0, 1, 2, 3, 4, 5, 6] : Array.from({ length: 30 }, (_, i) => i % 7);
  const grid: Record<number, Mini[]> = {};
  for (const d of new Set(days)) {
    const sch = period === 'day' && inp.live ? inp.live.sched : plannedSched(ctx, inp.plan, d);
    grid[d] = GRID.map((m) => mini(summarise(ctx, evalDay(ctx, d, m, sch, period === 'day' ? inp.live?.boost : null, period === 'day' ? 1 : attend(ctx)))));
  }
  const exp: MCResult['exp'] = { ch: {} as any, lang: {}, perDay: days.map((d) => grid[d][G1]), busy: 0, avail: 0 };
  for (const c of CH) exp.ch[c] = { off: 0, sla: 0, ab: 0, asa: 0, slc: 0 };
  for (const d of days) {
    const g = grid[d][G1];
    exp.busy += g.busy; exp.avail += g.avail;
    for (const c of CH) for (const k in exp.ch[c]) (exp.ch[c] as any)[k] += (g[c] as any)[k];
    for (const L in g.lang) {
      exp.lang[L] = exp.lang[L] || ({} as any);
      for (const c of CH) { const t = exp.lang[L][c] || (exp.lang[L][c] = { off: 0, sla: 0, ab: 0 }); t.off += g.lang[L][c].off; t.sla += g.lang[L][c].sla; t.ab += g.lang[L][c].ab; }
    }
  }
  const sig = S.fcErr / 100, meet = {} as Record<Channel, number>, samples = {} as Record<Channel, number[]>;
  for (const c of CH) { samples[c] = []; meet[c] = 0; }
  let mAb = 0;
  const at = attend(ctx), due: Record<number, number> = {};
  if (period !== 'day') for (const d of new Set(days)) due[d] = getTeams(ctx).reduce((a, t) => a + rosterSize(ctx, inp.hc, t.id, d), 0);
  for (let r = 0; r < R; r++) {
    const zc = gz(), tot = {} as Record<Channel, Tot>;
    for (const c of CH) tot[c] = { off: 0, sla: 0, ab: 0 };
    for (const d of days) {
      let m = 1 + sig * (0.5 * zc + 0.866 * gz());
      if (period !== 'day') { const ex = due[d] * at; if (ex > 0) { const pres = Math.max(1, ex + Math.sqrt(due[d] * at * (1 - at)) * gz()); m *= ex / pres; } }
      const x = interp(grid[d], m);
      for (const c of CH) { tot[c].off += x[c].off; tot[c].sla += x[c].sla; tot[c].ab += x[c].ab; }
    }
    for (const c of CH) { if (tot[c].off <= 0) continue; const sl = tot[c].sla / tot[c].off; samples[c].push(sl); if (sl >= S.ch[c].slPct / 100) meet[c]++; }
    if (tot.voice.off > 0 && tot.voice.ab / tot.voice.off <= S.abTarget / 100) mAb++;
  }
  const P = {} as MCResult['P'];
  for (const c of CH) P[c] = samples[c].length ? meet[c] / samples[c].length : null;
  P.ab = exp.ch.voice.off > 0 ? mAb / R : null;
  return { period, days, exp, P, samples };
}
